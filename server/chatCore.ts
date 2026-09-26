import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { searchLiveWeb, type LiveSearchResult } from "./search.ts";

dotenv.config();

const SYSTEM_INSTRUCTION = `You are a real-time web search engine.

ROLE & STYLE CONSTRAINTS:
- Deliver direct, definitive, and accurate answers in plain English.
- Lead directly with the factual answer in the very first sentence.
- NEVER state your name, model name, identity, or developer (do NOT say "I am Web Search Assistant", "I am Nemotron", "I am an AI", "As a language model", etc.).
- Never output raw bracket labels (like [WIKIPEDIA FACTUAL GROUNDING] or [REAL-TIME NEWS & MEDIA COVERAGE]), internal debug tags, or model citations in the text.
- Use bullet points for specific data, metrics, prices, and facts.
- Answer must be completely factual and grounded in the latest real-time web information.`;

const FALLBACK_INSTRUCTION = `You are a real-time web search engine.

ROLE & BEHAVIOR:
- Answer the user's question directly, simply, and concisely.
- Lead with the definitive answer in the first sentence.
- Never state any name, persona, or identity.
- Use plain language and clean bullet points for facts and figures.`;

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
  // Bigger models for highest accuracy: Nemotron and flagship 70B/340B/405B models
  // Prioritizing Nemotron 70B & 340B as requested ("use nemotron 3 like that modules insted of less models")
  const models = [
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "nvidia/nemotron-4-340b-instruct",
    "meta/llama-3.1-405b-instruct",
    "meta/llama-3.3-70b-instruct",
    "deepseek-ai/deepseek-r1",
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
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(15000),
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
      text: "Hello! What can I search or find for you today? Ask about current events, breaking news, market prices, weather, technical facts, or any topic.",
      searchQueries: [],
      sources: [],
    };
  }

  // 2. WEB FIRST SEARCH: Always fetch real-time web facts, news, encyclopedic, and market data first!
  const liveResults = await searchLiveWeb(latestUserQuery);
  let sources = [...liveResults.sources];
  let searchQueries = [...liveResults.searchQueries];

  const liveInstruction = `${SYSTEM_INSTRUCTION}

REAL-TIME WEB FIRST SEARCH RESULTS & GROUNDING FACTS:
${liveResults.context || "No live search results available."}

INSTRUCTIONS:
- Synthesize a direct, definitive, and accurate answer based on the real-time facts above.
- Lead directly with the answer in the first sentence.
- NEVER state your name, model name, or persona.
- Use clean bullet points for specific numbers, dates, prices, or details.
- Do not mention raw instruction tags or brackets.`;

  const nvidiaKey = getNvidiaKey();
  const ai = getAI();

  // 3. If NVIDIA key is configured, prioritize Nemotron / big NIM models as requested
  if (nvidiaKey) {
    const nvidiaText = await callNvidiaNIM(messages, liveInstruction, nvidiaKey);
    if (nvidiaText) {
      return {
        text: nvidiaText,
        searchQueries,
        sources,
      };
    }
  }

  // 4. Gemini processing using big model (gemini-2.5-pro / gemini-2.5-flash) with Google Search grounding
  if (ai) {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" || m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    let response: any;
    const isSearchInCooldown = Date.now() < searchQuotaCooldownUntil;

    if (!isSearchInCooldown) {
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.5-pro",
          contents,
          config: {
            systemInstruction: liveInstruction,
            tools: [{ googleSearch: {} }],
          },
        });

        const grounding = response?.candidates?.[0]?.groundingMetadata;
        if (grounding?.webSearchQueries?.length) {
          searchQueries = Array.from(new Set([...searchQueries, ...grounding.webSearchQueries]));
          const seenUris = new Set(sources.map((s) => s.uri));
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
      } catch (proErr: unknown) {
        if (isQuotaOrRateLimitError(proErr)) {
          searchQuotaCooldownUntil = Date.now() + 60_000;
          console.log("[Info] Gemini Pro search quota reached, falling back to Gemini Flash with live grounding.");
        } else {
          console.log("[Info] Gemini Pro fallback triggered:", cleanErrorMessage(proErr));
        }

        // Try gemini-2.5-flash or gemini-3.8-flash with live web grounding
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
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
          } catch (flashErr) {
            console.warn("[Warning] All Gemini attempts failed:", cleanErrorMessage(flashErr));
          }
        }
      }
    } else {
      // Cooldown active, use gemini-2.5-pro or flash with pre-fetched live web grounding
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.5-pro",
          contents,
          config: {
            systemInstruction: liveInstruction,
          },
        });
      } catch {
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents,
            config: {
              systemInstruction: liveInstruction,
            },
          });
        } catch (flashErr) {
          console.warn("[Warning] Gemini fallback during cooldown failed:", cleanErrorMessage(flashErr));
        }
      }
    }

    let responseText = extractResponseText(response);
    if (responseText && responseText.trim()) {
      return {
        text: responseText.trim(),
        searchQueries,
        sources,
      };
    }
  }

  // 5. If models are unavailable or returned empty, present the clean direct web search findings
  return {
    text: formatCleanDirectResults(latestUserQuery, liveResults),
    searchQueries,
    sources,
  };
}
