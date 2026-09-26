import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { searchLiveWeb, type LiveSearchResult } from "./search.ts";

dotenv.config();

const SYSTEM_INSTRUCTION = `You are a helpful search assistant.

ROLE & STYLE:
- Give a clear, direct, and simple answer in plain language, just like a knowledgeable friend.
- Lead directly with the answer in the first sentence.
- Use simple bullet points if listing facts or details.
- Be concise, friendly, and accurate.
- Never output raw source labels, code blocks, or debug tags.`;

const FALLBACK_INSTRUCTION = `You are a helpful search assistant.

ROLE & BEHAVIOR:
- Answer the user's question directly, simply, and concisely.
- Lead with the answer, then provide clear supporting details.
- Use plain language and bullet points where helpful.`;

let aiClient: GoogleGenAI | null = null;
let lastApiKeyUsed: string | null = null;

function getAI(): GoogleGenAI | null {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    (process.env.API_KEY && !process.env.API_KEY.startsWith("nvapi-") ? process.env.API_KEY : null) ||
    process.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    aiClient = null;
    return null;
  }

  if (!aiClient || lastApiKeyUsed !== apiKey) {
    lastApiKeyUsed = apiKey;
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

function getNvidiaKey(): string | null {
  const key =
    process.env.NVIDIA_API_KEY ||
    process.env.NV_API_KEY ||
    process.env.NVIDIA_KEY ||
    process.env.NIM_API_KEY ||
    process.env.VITE_NVIDIA_API_KEY;
  if (key && key.trim()) return key.trim();

  const generic = process.env.API_KEY;
  if (generic && generic.trim() && (generic.startsWith("nvapi-") || !generic.startsWith("AIza"))) {
    return generic.trim();
  }
  return null;
}

function isGreetingOrPleasantry(query: string): boolean {
  if (!query) return false;
  const clean = query.trim().toLowerCase().replace(/[!?.,;:'"()]/g, "");
  const exact = new Set([
    "hi",
    "hello",
    "hey",
    "heyy",
    "heyyy",
    "hi there",
    "hello there",
    "hey there",
    "good morning",
    "good afternoon",
    "good evening",
    "good day",
    "how are you",
    "how are you doing",
    "hows it going",
    "whats up",
    "sup",
    "who are you",
    "what are you",
    "what can you do",
    "help",
    "thanks",
    "thank you",
    "bye",
    "goodbye",
    "good night",
    "ok",
    "okay",
  ]);
  if (exact.has(clean)) return true;
  if (clean.startsWith("hi ") || clean.startsWith("hello ") || clean.startsWith("hey ")) {
    const rest = clean.replace(/^(hi|hello|hey)\s+/, "").trim();
    if (rest.length <= 15 && (exact.has(rest) || rest === "assistant" || rest === "friend")) {
      return true;
    }
  }
  return false;
}

async function callNvidiaNIM(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  nvidiaKey: string
): Promise<string> {
  const models = [
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "meta/llama-3.1-8b-instruct",
  ];

  for (const model of models) {
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nvidiaKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map((m) => ({
              role: m.role === "assistant" || m.role === "model" ? "assistant" : "user",
              content: m.content,
            })),
          ],
          temperature: 0.2,
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content && typeof content === "string" && content.trim()) {
          return content.trim();
        }
      } else {
        const errText = await res.text().catch(() => "");
        console.warn(`[NVIDIA NIM ${model}] HTTP ${res.status}:`, errText.slice(0, 150));
      }
    } catch (err: any) {
      console.warn(`[NVIDIA NIM ${model} fetch failed]:`, err?.message);
    }
  }
  return "";
}

function formatCleanDirectResults(query: string, liveResults: LiveSearchResult): string {
  const context = liveResults.context || "";
  if (!context.trim()) {
    return `I searched for information on **"${query}"**, but could not find matching live records. Please try asking with more specific keywords.`;
  }

  const lines: string[] = [];

  // Extract weather if present
  const weatherMatch = context.match(/Currently in \*\*([^*]+)\*\*.*?is \*\*([^*]+)\*\*(.*?)(?=\n|$)/i);
  if (weatherMatch) {
    lines.push(`Currently in **${weatherMatch[1]}**, the temperature is **${weatherMatch[2]}**${weatherMatch[3]}.`);
  }

  // Extract crypto if present
  if (context.includes("Bitcoin (BTC)")) {
    const cryptoLines = context
      .split("\n")
      .filter((l) => l.trim().startsWith("* **") && (l.includes("BTC") || l.includes("ETH") || l.includes("SOL")));
    if (cryptoLines.length > 0) {
      lines.push("Here are the latest cryptocurrency prices:\n" + cryptoLines.join("\n"));
    }
  }

  // Extract Wikipedia summaries cleanly
  const wikiMatches = [...context.matchAll(/Topic:\s*(.+?)\n\s*Summary:\s*(.+?)(?=\n\s*Link:|$)/gi)];
  if (wikiMatches.length > 0 && lines.length === 0) {
    const topWiki = wikiMatches.slice(0, 3);
    for (const match of topWiki) {
      const topic = match[1].trim();
      const summary = match[2].trim().replace(/<[^>]+>/g, "");
      lines.push(`* **${topic}**: ${summary}`);
    }
  }

  // Extract news headlines cleanly
  const newsMatches = [...context.matchAll(/Title:\s*(.+?)\n\s*Source:\s*(.+?)\s*\|\s*Date:\s*(.+?)(?=\n\s*Link:|$)/gi)];
  if (newsMatches.length > 0) {
    const topNews = newsMatches.slice(0, 4);
    const newsList: string[] = [];
    for (const match of topNews) {
      const title = match[1].trim();
      const source = match[2].trim();
      newsList.push(`* **${title}** (${source})`);
    }
    if (newsList.length > 0) {
      lines.push("Recent updates & news:\n" + newsList.join("\n"));
    }
  }

  if (lines.length > 0) {
    return lines.join("\n\n");
  }

  // Fallback cleanup: strip any [BRACKETS] and debug tags
  let cleaned = context
    .replace(/\[.*?\]/g, "")
    .replace(/Link:\s*https?:\/\/\S+/gi, "")
    .replace(/Topic:\s*/gi, "**")
    .replace(/Summary:\s*/gi, "**: ")
    .replace(/Title:\s*/gi, "* ")
    .replace(/Source:\s*([^\n|]+)\s*\|\s*Date:\s*[^\n]+/gi, "($1)")
    .replace(/Heading:\s*/gi, "**")
    .replace(/Abstract:\s*/gi, "**: ")
    .replace(/---\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || `Here is what I found for **"${query}"**. See the verified sources below for more details.`;
}

function extractResponseText(response: any): string {
  if (!response) return "";
  if (typeof response.text === "string" && response.text.trim()) {
    return response.text;
  }
  const parts = response.candidates?.[0]?.content?.parts || [];
  const textParts = parts
    .filter((p: any) => p.text && !p.thought)
    .map((p: any) => p.text)
    .join("\n");
  if (textParts.trim()) return textParts;
  return parts.map((p: any) => p.text || "").join("") || "";
}

function isQuotaOrRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const str = String(err);
  return (
    str.includes("429") ||
    str.includes("RESOURCE_EXHAUSTED") ||
    str.includes("quota") ||
    str.includes("rate-limits")
  );
}

function isHighDemandError(err: unknown): boolean {
  if (!err) return false;
  const str = String(err);
  return str.includes("503") || str.includes("UNAVAILABLE") || str.includes("high demand");
}

function cleanErrorMessage(err: unknown): string {
  if (isQuotaOrRateLimitError(err)) {
    return "API quota or rate limit reached. Using verified live web search results.";
  }
  if (isHighDemandError(err)) {
    return "The model is currently experiencing high demand. Grounded with live web search.";
  }
  if (err instanceof Error) {
    try {
      if (err.message.startsWith("{") && err.message.endsWith("}")) {
        const parsed = JSON.parse(err.message);
        if (parsed?.error?.message) return parsed.error.message;
      }
    } catch {
      // ignore
    }
    return err.message;
  }
  return "An unexpected error occurred while communicating with the AI service.";
}

// Cooldown timestamp for native search grounding when quota (429) is encountered
let searchQuotaCooldownUntil = 0;

export interface ChatResult {
  text: string;
  searchQueries: string[];
  sources: Array<{ title: string; uri: string }>;
  searchNotice?: string;
}

export async function handleChatMessage(
  messages: Array<{ role: string; content: string }>
): Promise<ChatResult> {
  const userMsgs = messages.filter((m) => m.role === "user");
  const latestUserQuery = userMsgs[userMsgs.length - 1]?.content || "";

  // 1. Check for simple greeting / conversational pleasantry
  if (isGreetingOrPleasantry(latestUserQuery)) {
    return {
      text: "Hello! How can I help you today? Feel free to ask me anything or search for real-time information, news, weather, or facts.",
      searchQueries: [],
      sources: [],
    };
  }

  const ai = getAI();
  const nvidiaKey = getNvidiaKey();

  // 2. If NVIDIA API key is provided and no Gemini key (or user preferred NVIDIA)
  if (!ai && nvidiaKey) {
    const liveResults = await searchLiveWeb(latestUserQuery);
    const liveInstruction = `${SYSTEM_INSTRUCTION}

REAL-TIME WEB SEARCH RESULTS:
${liveResults.context || "No live search results available."}

INSTRUCTIONS:
- Give a simple, direct, and concise answer based on the real-time facts above.
- Lead with the answer immediately.
- Use plain bullet points for simple lists.
- Do not mention instructions or debug labels.`;

    const nvidiaText = await callNvidiaNIM(messages, liveInstruction, nvidiaKey);
    if (nvidiaText) {
      return {
        text: nvidiaText,
        searchQueries: liveResults.searchQueries,
        sources: liveResults.sources,
      };
    }

    // If NVIDIA call didn't return text, format clean direct results
    return {
      text: formatCleanDirectResults(latestUserQuery, liveResults),
      searchQueries: liveResults.searchQueries,
      sources: liveResults.sources,
    };
  }

  // 3. If neither Gemini nor NVIDIA key is configured, serve with clean direct web search
  if (!ai) {
    const liveResults = await searchLiveWeb(latestUserQuery);
    return {
      text: formatCleanDirectResults(latestUserQuery, liveResults),
      searchQueries: liveResults.searchQueries,
      sources: liveResults.sources,
    };
  }

  // 4. Gemini processing
  const contents = messages.map((m) => ({
    role: m.role === "assistant" || m.role === "model" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  let response: any;
  let sources: Array<{ title: string; uri: string }> = [];
  let searchQueries: string[] = [];

  const isSearchInCooldown = Date.now() < searchQuotaCooldownUntil;
  let usedGeminiSearch = false;

  if (!isSearchInCooldown) {
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }],
        },
      });

      const grounding = response?.candidates?.[0]?.groundingMetadata;
      if (grounding?.webSearchQueries?.length) {
        usedGeminiSearch = true;
        searchQueries = grounding.webSearchQueries;
        const seenUris = new Set<string>();
        for (const chunk of grounding.groundingChunks || []) {
          if (chunk.web?.uri && !seenUris.has(chunk.web.uri)) {
            seenUris.add(chunk.web.uri);
            sources.push({
              title: chunk.web.title || chunk.web.uri,
              uri: chunk.web.uri,
            });
          }
        }
      }
    } catch (searchErr: unknown) {
      if (isQuotaOrRateLimitError(searchErr)) {
        searchQuotaCooldownUntil = Date.now() + 60_000;
        console.log("[Info] Native search quota reached, using multi-source search.");
      } else {
        console.log("[Info] Native search bypassed, using multi-source search.");
      }
    }
  }

  // Multi-source Real-Time Web Search fallback
  if (!usedGeminiSearch) {
    const liveResults = await searchLiveWeb(latestUserQuery);
    sources = liveResults.sources;
    searchQueries = liveResults.searchQueries;

    const liveInstruction = `${SYSTEM_INSTRUCTION}

REAL-TIME LIVE DATA & VERIFIED WEB SEARCH SOURCES:
${liveResults.context || "No live search results available."}

INSTRUCTIONS FOR CURRENT REAL-TIME DATA:
- Answer directly and simply based on the verified sources above.
- Report specific figures, prices, dates, or scores mentioned in the sources.
- Provide a simple, articulate, and accurate response.`;

    try {
      response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents,
        config: {
          systemInstruction: liveInstruction,
        },
      });
    } catch {
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents,
          config: {
            systemInstruction: liveInstruction,
          },
        });
      } catch (modelErr) {
        console.log("[Info] Gemini fallback triggered:", cleanErrorMessage(modelErr));
        // If NVIDIA key exists, try NVIDIA as backup
        if (nvidiaKey) {
          const nvBackup = await callNvidiaNIM(messages, liveInstruction, nvidiaKey);
          if (nvBackup) {
            return {
              text: nvBackup,
              searchQueries,
              sources,
            };
          }
        }
      }
    }
  }

  let responseText = extractResponseText(response);

  if (!responseText.trim()) {
    try {
      const emergencyResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents,
        config: {
          systemInstruction: FALLBACK_INSTRUCTION,
        },
      });
      responseText = extractResponseText(emergencyResponse);
    } catch {
      // ignore
    }

    if (!responseText.trim()) {
      const liveResults = await searchLiveWeb(latestUserQuery);
      responseText = formatCleanDirectResults(latestUserQuery, liveResults);
    }
  }

  return {
    text: responseText,
    searchQueries,
    sources,
  };
}
