import { ExternalLink, Globe, Search } from "lucide-react";
import { GroundingSource } from "../types";

interface SourcesListProps {
  searchQueries?: string[];
  sources?: GroundingSource[];
}

export function SourcesList({ searchQueries, sources }: SourcesListProps) {
  const hasQueries = searchQueries && searchQueries.length > 0;
  const hasSources = sources && sources.length > 0;

  if (!hasQueries && !hasSources) {
    return null;
  }

  // Extract domain name cleanly for display
  const getDomain = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, "");
    } catch {
      return "Web Source";
    }
  };

  return (
    <div className="mt-3.5 pt-3 border-t border-zinc-100 flex flex-col gap-2.5 text-xs">
      {/* Search Queries Executed */}
      {hasQueries && (
        <div className="flex flex-wrap items-center gap-1.5 text-zinc-600">
          <span className="inline-flex items-center gap-1 font-medium text-zinc-500">
            <Search className="h-3 w-3 text-zinc-400" />
            Searched:
          </span>
          {searchQueries.map((query, idx) => (
            <span
              key={idx}
              className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-700"
            >
              "{query}"
            </span>
          ))}
        </div>
      )}

      {/* Verified Web Sources */}
      {hasSources && (
        <div>
          <div className="flex items-center gap-1 mb-1.5 font-medium text-zinc-500">
            <Globe className="h-3 w-3 text-zinc-400" />
            <span>Verified Sources ({sources.length}):</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source, idx) => {
              const domain = getDomain(source.uri);
              return (
                <a
                  key={idx}
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1 text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 group"
                  title={source.title}
                >
                  <span className="font-semibold text-zinc-900">{domain}</span>
                  <span className="max-w-[140px] truncate text-zinc-500 font-normal group-hover:text-zinc-700">
                    {source.title}
                  </span>
                  <ExternalLink className="h-2.5 w-2.5 text-zinc-400 group-hover:text-zinc-600 shrink-0" />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
