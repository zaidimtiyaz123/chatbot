import { handleChatMessage } from "../server/chatCore.ts";

export default async function handler(req: any, res: any) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Please use POST." });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // use raw body
      }
    }

    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Missing or invalid 'messages' array in request body." });
      return;
    }

    const result = await handleChatMessage(messages);
    res.status(200).json(result);
  } catch (err: any) {
    console.error("[Vercel /api/chat error]:", err);
    res.status(200).json({
      text: "I experienced a temporary issue reaching the AI backend. Please verify your query or try again shortly.",
      searchQueries: [],
      sources: [],
      searchNotice: err?.message || "Serverless execution notice",
    });
  }
}
