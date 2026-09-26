import { Globe, RotateCcw, Search, ShieldCheck } from "lucide-react";

interface HeaderProps {
  onReset: () => void;
  messageCount: number;
}

export function Header({ onReset, messageCount }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 shadow-xs">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-sm">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-zinc-900">
                Web First Search
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Web-First Active
              </span>
            </div>
            <p className="text-xs text-zinc-500 hidden sm:block">
              Searches live web sources, breaking news, and verified facts first before answering
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {messageCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 active:scale-95"
              title="Reset conversation"
            >
              <RotateCcw className="h-3.5 w-3.5 text-zinc-500" />
              <span>Reset</span>
            </button>
          )}

          <div className="hidden md:flex items-center gap-1.5 text-xs text-zinc-400 pl-2 border-l border-zinc-200">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Fact-Grounded</span>
          </div>
        </div>
      </div>
    </header>
  );
}
