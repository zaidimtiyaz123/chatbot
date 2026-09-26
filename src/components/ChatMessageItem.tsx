import { useState } from "react";
import Markdown from "react-markdown";
import { Check, Copy, User, Globe, AlertCircle, RefreshCw, Info } from "lucide-react";
import { ChatMessage } from "../types";
import { SourcesList } from "./SourcesList";

interface ChatMessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
}

export function ChatMessageItem({ message, onRetry }: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const formattedTime = new Intl.DateTimeFormat("default", {
    hour: "numeric",
    minute: "numeric",
  }).format(new Date(message.timestamp));

  if (isUser) {
    return (
      <div className="flex justify-end gap-3 items-start my-4">
        <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%]">
          <div className="rounded-2xl rounded-tr-xs bg-zinc-900 px-4 py-2.5 text-white shadow-xs">
            <p className="text-sm sm:text-[0.9375rem] leading-relaxed whitespace-pre-wrap select-text">
              {message.content}
            </p>
          </div>
          <span className="mt-1 text-[11px] text-zinc-400 font-mono px-1">
            {formattedTime}
          </span>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200 text-xs font-medium">
          <User className="h-4 w-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start my-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-xs">
        <Globe className="h-4 w-4" />
      </div>

      <div className="flex flex-col items-start flex-1 min-w-0 max-w-[95%] sm:max-w-[88%]">
        <div
          className={`w-full rounded-2xl rounded-tl-xs border px-4 py-3.5 shadow-xs transition ${
            message.isError
              ? "border-rose-200 bg-rose-50/70 text-rose-900"
              : "border-zinc-200/90 bg-white text-zinc-800"
          }`}
        >
          {message.isError ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-rose-700 font-medium text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Web search encountered an issue</span>
              </div>
              <p className="text-xs sm:text-sm text-rose-800 leading-relaxed">
                {message.content}
              </p>
              {message.content.toLowerCase().includes("quota") && (
                <div className="mt-1 rounded-lg bg-white/70 border border-rose-200 p-2.5 text-xs text-rose-800 flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-rose-600 mt-0.5 shrink-0" />
                  <span>
                    To enable higher request volume and unlimited Google Search grounding, select a billing-enabled Gemini API key in <strong>Settings &gt; Secrets</strong>.
                  </span>
                </div>
              )}
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-1 self-start inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 active:scale-95 transition"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Retry Search</span>
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="markdown-body">
                <Markdown
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline hover:text-blue-800 break-words"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {message.content}
                </Markdown>
              </div>

              {/* Grounded Sources & Queries */}
              <SourcesList
                searchQueries={message.searchQueries}
                sources={message.sources}
              />
            </>
          )}
        </div>

        {/* Action bar below message */}
        <div className="mt-1 flex items-center gap-3 px-1 text-[11px] text-zinc-400">
          <span>{formattedTime}</span>
          {!message.isError && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 hover:text-zinc-700 transition"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-600">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
