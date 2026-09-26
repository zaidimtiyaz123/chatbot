import { useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { ArrowUp, Loader2, Search } from "lucide-react";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function ChatInput({ input, setInput, onSubmit, isLoading }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        180
      )}px`;
    }
  }, [input]);

  // Global shortcut: press '/' to focus chat input
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        document.activeElement !== textareaRef.current &&
        !(
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement ||
          (document.activeElement as HTMLElement)?.isContentEditable
        )
      ) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isModifierEnter = e.key === "Enter" && (e.ctrlKey || e.metaKey);
    const isPlainEnter = e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey;

    if (isModifierEnter || isPlainEnter) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        onSubmit();
      }
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  return (
    <div className="border-t border-zinc-200 bg-white/95 backdrop-blur-md p-3 sm:p-4 sticky bottom-0 z-20">
      <div className="mx-auto max-w-4xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim() && !isLoading) {
              onSubmit();
            }
          }}
          className="relative flex items-end gap-2 rounded-2xl border border-zinc-300/80 bg-zinc-50/50 p-2 shadow-xs transition-within focus-within:border-zinc-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-zinc-900/5"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-400 pl-1">
            <Search className="h-4 w-4" />
          </div>

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Ask a question (e.g. current events, prices, facts, availability)..."
            className="w-full resize-none bg-transparent py-2 px-1 text-sm sm:text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-60 max-h-44 min-h-[38px] leading-relaxed"
          />

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-zinc-900 active:scale-95"
            title="Send query"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4 stroke-[2.5]" />
            )}
          </button>
        </form>

        <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-zinc-400">
          <span>
            Press <strong>Enter</strong> or <strong>Ctrl/⌘+Enter</strong> to ask, <strong>Shift+Enter</strong> for a new line
          </span>
          <span className="hidden sm:inline-flex items-center gap-1">
            Press <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1 py-0.5 font-mono text-[10px] text-zinc-600">/</kbd> to focus
          </span>
        </div>
      </div>
    </div>
  );
}
