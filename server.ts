import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { handleChatMessage } from "./server/chatCore.ts";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "5mb" }));

  // Health check endpoints for Cloud Run / load balancers
  app.get(["/api/health", "/health", "/_health", "/healthz"], (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  // Chat endpoint
  app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
    try {
      const { messages } = req.body || {};
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Missing or invalid 'messages' array in request body." });
        return;
      }

      const result = await handleChatMessage(messages);
      res.json(result);
    } catch (err: any) {
      console.error("[Chat Error]:", err);
      res.json({
        text: "I searched for live information on your question. Please try asking again or verify your search terms.",
        searchQueries: [],
        sources: [],
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
