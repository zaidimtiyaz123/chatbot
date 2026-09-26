import { Search, Compass, TrendingUp, Sparkles, HelpCircle } from "lucide-react";

interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void;
}

const SUGGESTIONS = [
  {
    icon: TrendingUp,
    category: "Current Facts & Events",
    query: "What are the latest headlines and breakthroughs in AI this week?",
  },
  {
    icon: Search,
    category: "Real-time Prices & Data",
    query: "What is the current price and market trend of Bitcoin and Ethereum?",
  },
  {
    icon: Compass,
    category: "Weather & Conditions",
    query: "What is the 3-day weather forecast for Tokyo right now?",
  },
  {
    icon: Sparkles,
    category: "Space & Science",
    query: "What are the newest discoveries confirmed by the James Webb Space Telescope?",
  },
];

export function SuggestedPrompts({ onSelectPrompt }: SuggestedPromptsProps) {
  return (
    <div className="flex flex-col items-center justify-center my-auto py-10 px-4 text-center max-w-2xl mx-auto">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-white shadow-md mb-4">
        <Search className="h-7 w-7 text-white" />
      </div>

      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
        How can I help you search today?
      </h2>

      <p className="mt-2 text-sm text-zinc-600 max-w-md leading-relaxed">
        I am <strong>Web Search Assistant</strong>, your search assistant. I check reliable, up-to-date sources before answering factual questions.
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
        {SUGGESTIONS.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectPrompt(item.query)}
              className="flex items-start gap-3 p-3.5 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/80 transition shadow-2xs group text-left"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 group-hover:bg-zinc-900 group-hover:text-white transition">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                  {item.category}
                </span>
                <span className="text-xs sm:text-sm text-zinc-800 font-medium line-clamp-2 mt-0.5">
                  "{item.query}"
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
