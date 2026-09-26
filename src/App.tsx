import { useState, useRef, useEffect } from "react";
import { Header } from "./components/Header";
import { ChatMessageItem } from "./components/ChatMessageItem";
import { ChatInput } from "./components/ChatInput";
import { SuggestedPrompts } from "./components/SuggestedPrompts";
import { SearchingIndicator } from "./components/SearchingIndicator";
import { ChatMessage } from "./types";
import { searchClientLive } from "./services/clientLiveSearch";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback if restricted
    }
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages or loading change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const userText = (textToSend || input).trim();
    if (!userText || isLoading) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: userText,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    if (!textToSend) {
      setInput("");
    }
    setIsLoading(true);

    try {
      // Prepare history payload for server
      const payloadMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let botResponseData: any = null;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payloadMessages }),
        });

        const contentType = res.headers.get("content-type") || "";

        if (res.ok && contentType.includes("application/json")) {
          botResponseData = await res.json();
        } else {
          console.warn(`[Search Warning]: API status ${res.status}. Engaging resilient fallback.`);
        }
      } catch (fetchErr) {
        console.warn("[Search Warning]: Backend API unreachable. Engaging resilient live search fallback:", fetchErr);
      }

      // If backend did not provide a valid response, use client-side live search fallback
      if (!botResponseData || !botResponseData.text) {
        const clientResult = await searchClientLive(userText);
        botResponseData = {
          text: clientResult.text,
          searchQueries: clientResult.searchQueries,
          sources: clientResult.sources,
          searchNotice: clientResult.searchNotice,
        };
      }

      const botMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: botResponseData.text || "No response received.",
        timestamp: Date.now(),
        searchQueries: botResponseData.searchQueries,
        sources: botResponseData.sources,
        searchNotice: botResponseData.searchNotice,
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to connect to the search service.";

      const errorBotMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: errorMessage,
        timestamp: Date.now(),
        isError: true,
      };

      setMessages((prev) => [...prev, errorBotMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = (errorIndex: number) => {
    // Find the last user message before this error
    const precedingUserMessage = [...messages.slice(0, errorIndex)]
      .reverse()
      .find((m) => m.role === "user");

    if (precedingUserMessage) {
      // Remove the error message
      const trimmed = messages.filter((_, idx) => idx !== errorIndex);
      setMessages(trimmed);
      handleSendMessage(precedingUserMessage.content);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setInput("");
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans text-zinc-900">
      {/* Top Header */}
      <Header onReset={handleReset} messageCount={messages.length} />

      {/* Main Chat Container */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        <div className="mx-auto flex h-full max-w-4xl flex-col justify-between">
          {messages.length === 0 ? (
            <SuggestedPrompts onSelectPrompt={(prompt) => handleSendMessage(prompt)} />
          ) : (
            <div className="flex flex-col py-2">
              {messages.map((message, index) => (
                <ChatMessageItem
                  key={message.id}
                  message={message}
                  onRetry={message.isError ? () => handleRetry(index) : undefined}
                />
              ))}

              {isLoading && <SearchingIndicator />}

              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>
      </main>

      {/* Sticky Bottom Input */}
      <ChatInput
        input={input}
        setInput={setInput}
        onSubmit={() => handleSendMessage()}
        isLoading={isLoading}
      />
    </div>
  );
}
