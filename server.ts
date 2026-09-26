import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { searchLiveWeb } from "./server/search.ts";

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

let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }
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

const FALLBACK_INSTRUCTION = `You are "Web Search Assistant", a search assistant.

ROLE & BEHAVIOR
- Answer the user's question directly, accurately, and concisely.
- Lead with the answer, then provide clear supporting details.
- Use plain language and bullet points where helpful.
- If information is time-sensitive or might have changed recently, note that politely.`;

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
    return "Gemini API quota or rate limit exceeded. If you are on the free tier, the request limit has been reached. Please wait a moment before trying again, or select a billing-enabled API key in Settings > Secrets.";
  }
  if (isHighDemandError(err)) {
    return "The model is currently experiencing high demand. Please try again in a few moments.";
  }
  if (err instanceof Error) {
    // Check if message is JSON stringified ApiError
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

// Cooldown timestamp for search grounding when quota (429) is encountered
let searchQuotaCooldownUntil = 0;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "5mb" }));

  // Health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      searchActive: Date.now() >= searchQuotaCooldownUntil,
    });
  });

  // Chat endpoint with Google Search grounding and graceful fallback
  app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Missing or invalid 'messages' array in request body." });
        return;
      }

      // Extract latest user query for targeted real-time search
      const userMsgs = messages.filter((m: { role: string; content: string }) => m.role === "user");
      const latestUserQuery = userMsgs[userMsgs.length - 1]?.content || "";

      const ai = getAI();
      if (!ai) {
        const liveResults = await searchLiveWeb(latestUserQuery);
        let text = "";
        if (liveResults.context) {
          text = `Here is what I found online for **"${latestUserQuery}"**:\n\n` +
            liveResults.context + "\n\n" +
            (liveResults.sources.length > 0
              ? "### Verified Sources:\n" + liveResults.sources.slice(0, 6).map(s => `* [${s.title}](${s.uri})`).join("\n")
              : "");
        } else {
          text = `I searched for information on **"${latestUserQuery}"**, but could not retrieve matching live records. Please try asking with more specific keywords.`;
        }
        res.json({
          text,
          searchQueries: liveResults.searchQueries,
          sources: liveResults.sources,
          searchNotice: "Live web search results (direct query mode).",
        });
        return;
      }

      // Convert conversation history to Gemini contents format
      const contents = messages.map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" || m.role === "model" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      let response;
      let searchNotice: string | undefined;
      let sources: { title: string; uri: string }[] = [];
      let searchQueries: string[] = [];

      const isSearchInCooldown = Date.now() < searchQuotaCooldownUntil;
      let usedGeminiSearch = false;

      // 1. Attempt native Google Search grounding if quota is available
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

      // 2. Multi-source Real-Time Web Search fallback
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
            console.log("[Info] Model generation fallback to direct live data synthesis:", cleanErrorMessage(modelErr));
          }
        }

        if (sources.length > 0) {
          searchNotice = `Grounded with real-time web sources (${sources.length} live verified sources).`;
        }
      }

      let responseText = extractResponseText(response);

      // If response text is still empty, synthesize directly from live results or emergency fallback
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
            responseText = `Here are the latest verified live results found for **"${latestUserQuery}"**:\n\n` +
              sources.slice(0, 5).map(s => `* [${s.title}](${s.uri})`).join("\n\n");
          } else {
            responseText = "I've searched for live information regarding your query, but could not retrieve matching verified sources right now. Please try asking with more specific keywords.";
          }
        }
      }

      res.json({
        text: responseText,
        searchQueries,
        sources,
        searchNotice,
      });
    } catch (err: unknown) {
      const errorMessage = cleanErrorMessage(err);
      console.log("[Chat Info]:", errorMessage);
      res.json({
        text: "I searched for live information on your question. Please try asking again or verify your search terms.",
        searchQueries: [],
        sources: [],
        searchNotice: errorMessage,
      });
    }
  });

  // Vite middleware for development vs static build in production
  const distPath = path.join(process.cwd(), "dist");
  const hasDist = fs.existsSync(path.join(distPath, "index.html"));
  const isProduction =
    process.env.NODE_ENV === "production" ||
    (hasDist && process.env.npm_lifecycle_event !== "dev");

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global JSON error handler to prevent HTML stack traces or raw HTML errors
  app.use((err: any, _req: Request, res: Response, next: any) => {
    if (res.headersSent) {
      return next(err);
    }
    console.error("[Express Error Handler]:", err);
    res.status(500).json({
      error: err?.message || "An unexpected error occurred. Please try again.",
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
