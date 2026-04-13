"use client";

const SUGGESTIONS = [
  "Any clients looking for 2bed Marina under 2M who went cold?",
  "Who mentioned Damac Hills 2 in the last 3 months?",
  "Find me anyone selling a business who wants to buy a villa",
  "Which leads gave us a specific callback date?",
  "Show me all cash buyers with budgets over 2M",
  "Any leads who paused because of the conflict?",
];

export default function SuggestedQueries({ onSelect }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {SUGGESTIONS.map((query) => (
        <button
          key={query}
          onClick={() => onSelect(query)}
          className="text-left px-4 py-3 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-white/20 transition-all text-sm text-white/70 hover:text-white/90"
        >
          {query}
        </button>
      ))}
    </div>
  );
}
