import { HELP_COMMANDS } from "@/lib/console/help";
import { ConsoleShell } from "@/components/console/console-shell";

const TRANSCRIPT = [
  { who: "you", text: "what did Ahmed want?" },
  {
    who: "az",
    text: "Ahmed — 2BR Marina, under 2M, ready before September. Last inbound yesterday evening.",
  },
  { who: "you", text: "call Ahmed" },
  {
    who: "az",
    text: "Calling Ahmed now on the live re-engage script. I’ll text you when it lands.",
  },
  { who: "you", text: "summary" },
  {
    who: "az",
    text: "Overnight: 4 new inbound, 2 worth a call this morning. Fatima (Downtown) and Omar (JVC) first.",
  },
  { who: "you", text: "call my marina list with the cold list script" },
  {
    who: "az",
    text: "18 match after exclusions (2 opted out, 1 called Tuesday). Confirm and I’ll queue them this evening.",
  },
];

export function HowItWorks({ tenant }) {
  return (
    <ConsoleShell tenant={tenant} title="How it works">
      <p className="mb-6 text-sm leading-6 text-ink-2">
        A real morning on WhatsApp — the same four commands `help` returns on
        your phone.
      </p>
      <div className="space-y-3">
        {TRANSCRIPT.map((line, index) => (
          <div
            className={`max-w-[90%] rounded-md px-3 py-2 text-sm leading-6 ${
              line.who === "you"
                ? "ml-auto bg-ink text-background"
                : "border border-rule-2 bg-surface text-ink"
            }`}
            key={`${line.who}-${index}`}
          >
            {line.text}
          </div>
        ))}
      </div>
      <ul className="mt-8 space-y-1 font-mono text-[11px] uppercase tracking-label text-ink-3">
        {HELP_COMMANDS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </ConsoleShell>
  );
}
