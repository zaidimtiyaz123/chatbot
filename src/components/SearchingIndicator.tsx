import { Globe, Loader2, Search } from "lucide-react";

export function SearchingIndicator() {
  return (
    <div className="flex gap-3 items-start my-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-xs">
        <Globe className="h-4 w-4" />
      </div>

      <div className="flex flex-col items-start flex-1 min-w-0 max-w-[85%] sm:max-w-[75%]">
        <div className="rounded-2xl rounded-tl-xs border border-zinc-200/80 bg-white px-4 py-3 shadow-xs">
          <div className="flex items-center gap-2.5 text-zinc-700">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-900" />
            <span className="text-xs sm:text-sm font-medium">
              Searching live web sources & synthesizing answer...
            </span>
          </div>

          <div className="mt-2.5 flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Search className="h-3 w-3 text-zinc-400" />
              Web search query
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3 w-3 text-zinc-400" />
              Live web facts
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
