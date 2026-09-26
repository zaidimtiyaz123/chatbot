import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { searchLiveWeb } from "./search.ts";

dotenv.config();

const SYSTEM_INSTRUCTION = `You are "Web Search Assistant", a search assistant.

ROLE
- Your job is to answer user questions by searching for relevant, up-to-date information, then giving a clear, accurate answer.
- Always search before answering if the question involves facts, current events, prices, availability, or anything that could have changed recently. Don't rely only on memory for time-sensitive topics.

BEHAVIOR
1. Understand the user's question. If it's vague, ask one short clarifying question before searching.
2. Run a search using the available search tool with a short, specific query (3-6 words).
3. Read the top results and pick the most relevant, trustworthy ones (official sites, reputable sources over random blogs).
4. Summarize the answer in your own words — do not copy text directly from sources.
5. If sources disagree, mention that briefly instead of picking one silently.
6. If no good result is found, say so honestly instead of guessing.

RESPONSE STYLE
- Be concise and direct. Lead with the answer, then add supporting detail if needed.
- Use plain language, avoid jargon unless the user is clearly technical.
- Cite sources by name (e.g., "According to Reuters...") when relevant.
- Use bullet points for lists, plain sentences for simple answers.

LIMITS
- Don't make up facts, links, or statistics.
- Don't give medical, legal, or financial advice as fact — provide general info and suggest consulting a professional.
- If a query is outside your scope, politely redirect the user.

GOAL
Be fast, accurate, and easy to talk to — like a knowledgeable friend who always checks their facts before answering.`;

const FALLBACK_INSTRUCTION = `You are "Web Search Assistant", a search assistant.

ROLE & BEHAVIOR
- Answer the user's question directly, accurately, and concisely.
- Lead with the answer, then provide clear supporting details.
- Use plain language and bullet points where helpful.
- If information is time-sensitive or might have changed recently, note that politely.`;

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
  const key = process.env.NVIDIA_API_KEY || process.env.NV_API_KEY;
  if (key) return key.trim();
  const generic = process.env.API_KEY;
  if (generic && generic.startsWith("nvapi-")) return generic.trim();
  return null;
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
      }
    } catch {
      // try next model
    }
  }
  return "";
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
    return "Gemini API quota or rate limit reached. Using verified live web search results.";
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

  const ai = getAI();
  const nvidiaKey = getNvidiaKey();

  // 1. If NVIDIA API key is provided and no Gemini key (or user preferred NVIDIA)
  if (!ai && nvidiaKey) {
    const liveResults = await searchLiveWeb(latestUserQuery);
    const liveInstruction = `${SYSTEM_INSTRUCTION}

[REAL-TIME LIVE DATA & VERIFIED WEB SEARCH SOURCES]:
${liveResults.context || "No live search results available."}

INSTRUCTIONS FOR CURRENT REAL-TIME DATA:
- Answer based directly on the verified real-time sources above.
- Report specific figures, prices, dates, event outcomes, or scores mentioned in the sources.
- Cite the sources by name where helpful.
- Provide a direct, articulate, and accurate response.`;

    const nvidiaText = await callNvidiaNIM(messages, liveInstruction, nvidiaKey);
    if (nvidiaText) {
      return {
        text: nvidiaText,
        searchQueries: liveResults.searchQueries,
        sources: liveResults.sources,
        searchNotice: `Synthesized with NVIDIA NIM (${liveResults.sources.length} live verified sources).`,
      };
    }
  }

  // 2. If neither Gemini nor NVIDIA key is configured, serve directly with multi-source live web search
  if (!ai) {
    const liveResults = await searchLiveWeb(latestUserQuery);
    let text = "";
    if (liveResults.context) {
      text =
        `Here is the latest live information found for **"${latestUserQuery}"**:\n\n` +
        liveResults.context +
        "\n\n" +
        (liveResults.sources.length > 0
          ? "### Verified Sources:\n" +
            liveResults.sources.slice(0, 6).map((s) => `* [${s.title}](${s.uri})`).join("\n")
          : "");
    } else {
      text = `I searched for information on **"${latestUserQuery}"**, but could not retrieve matching live records. Please try asking with more specific keywords.`;
    }
    return {
      text,
      searchQueries: liveResults.searchQueries,
      sources: liveResults.sources,
      searchNotice:
        "Live web search results (direct query mode). You can also add GEMINI_API_KEY or NVIDIA_API_KEY in environment variables for AI model synthesis.",
    };
  }

  // 3. Gemini processing
  const contents = messages.map((m) => ({
    role: m.role === "assistant" || m.role === "model" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  let response: any;
  let searchNotice: string | undefined;
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
        console.log("[Info] Native search quota hit, activating multi-source real-time web search.");
      } else {
        console.log("[Info] Native search bypassed, using multi-source real-time web search.");
      }
    }
  }

  // Multi-source Real-Time Web Search fallback
  if (!usedGeminiSearch) {
    const liveResults = await searchLiveWeb(latestUserQuery);
    sources = liveResults.sources;
    searchQueries = liveResults.searchQueries;

    const liveInstruction = `${SYSTEM_INSTRUCTION}

[REAL-TIME LIVE DATA & VERIFIED WEB SEARCH SOURCES]:
${liveResults.context || "No live search results available."}

INSTRUCTIONS FOR CURRENT REAL-TIME DATA:
- Answer based directly on the verified real-time sources above.
- Report specific figures, prices, dates, event outcomes, or scores mentioned in the sources.
- Cite the sources by name where helpful.
- Provide a direct, articulate, and accurate response.`;

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
              searchNotice: `Synthesized with NVIDIA NIM (${sources.length} live verified sources).`,
            };
          }
        }
      }
    }

    if (sources.length > 0) {
      searchNotice = `Grounded with real-time web sources (${sources.length} live verified sources).`;
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
      if (sources.length > 0) {
        responseText =
          `Here are the latest verified live results found for **"${latestUserQuery}"**:\n\n` +
          sources.slice(0, 5).map((s) => `* [${s.title}](${s.uri})`).join("\n\n");
      } else {
        responseText =
          "I've searched for live information regarding your query, but could not retrieve matching verified sources right now. Please try asking with more specific keywords.";
      }
    }
  }

  return {
    text: responseText,
    searchQueries,
    sources,
    searchNotice,
  };
}
