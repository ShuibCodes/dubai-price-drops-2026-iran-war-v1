import { BarChart3, HandCoins } from "lucide-react";

const badges = [
  {
    icon: BarChart3,
    title: "For Investors",
    copy: "Pre-war vs current value gaps",
  },
  {
    icon: HandCoins,
    title: "For Agents",
    copy: "Pre-war vs current value gaps",
  },
];

export default function AudienceBadges() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {badges.map(({ icon: Icon, title, copy }) => (
        <div
          key={title}
          className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06]">
            <Icon className="h-4 w-4 text-[#ffd60a]" />
          </span>
          <div>
            <div
              className="text-[15px] font-extrabold text-white"
              style={{
                fontFamily: '"Roboto", -apple-system, BlinkMacSystemFont, sans-serif',
              }}
            >
              {title}
            </div>
            <div className="text-xs text-white/45">{copy}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
