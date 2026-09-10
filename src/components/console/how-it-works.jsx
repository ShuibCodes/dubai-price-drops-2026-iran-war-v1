import Link from "next/link";
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
  { who: "you", text: "how's the run" },
  {
    who: "az",
    text: "Cold list — 12/40 dialled. Ask me again later please.\n\nXenios +9715… · WARM\n“Not right now. Thank you, though.”",
  },
  { who: "you", text: "call my marina list with the cold list script" },
  {
    who: "az",
    text: "18 match after exclusions (2 opted out, 1 called Tuesday). Confirm and I’ll queue them this evening.",
  },
];

function steps(base) {
  return [
    {
      n: 1,
      title: "Upload what you sell",
      body: "Price lists, payment plans, brochures. This is what AgentZero quotes from — on calls and when you ask it a question at midnight.",
      actions: [
        { label: "Open Knowledge →", href: `${base}/kb`, kind: "ghost" },
      ],
    },
    {
      n: 2,
      title: "Add your leads",
      body: "Drop a CSV and name it — “Marina cold list”, “old enquiries”. Saving a list never dials anyone. You call it by that name later, from WhatsApp.",
      actions: [
        { label: "Upload a list →", href: `${base}/runs/new`, kind: "ghost" },
      ],
    },
    {
      n: 3,
      title: "Connect WhatsApp",
      body: "Your brokerage number, through Meta. Leads never chat with AgentZero — this is the line it texts you on.",
      actions: [
        { label: "Manage number →", href: `${base}/settings`, kind: "quiet" },
      ],
    },
    {
      n: 4,
      title: "Write a cold-call script",
      body: "Four questions: what is the goal, how does it open, what must it find out, which voice. Hear it yourself before anyone else does. Only LIVE scripts can call a list.",
      actions: [
        { label: "Open the editor →", href: `${base}/scripts`, kind: "primary" },
      ],
    },
  ];
}

const KIND = {
  primary: "bg-az font-semibold text-az-ink hover:bg-az-hover",
  ghost: "border border-line-3 font-medium text-fg hover:border-az hover:text-az",
  quiet: "border border-line-2 font-medium text-dim hover:text-fg",
};

export function HowItWorks({ tenant }) {
  const base = `/copilot/${encodeURIComponent(tenant)}`;

  return (
    <ConsoleShell footer={false} tenant={tenant} width={880}>
      <div className="az-eyebrow mb-4 block">THE JOURNEY</div>
      <h1 className="mb-4 text-[52px] font-semibold leading-none tracking-[-.035em] text-fg">
        Five steps, then it’s just texting.
      </h1>
      <p className="mb-14 max-w-[620px] text-[19px] leading-snug text-fg-2 [text-wrap:pretty]">
        Everything in this console is one of these five. Once they are done, you
        close the laptop and work from your phone.
      </p>

      <div className="relative pl-14">
        <div className="absolute bottom-[60px] left-[17px] top-3 w-0.5 bg-[linear-gradient(var(--az)_0%,var(--az)_58%,var(--line-2)_62%,var(--line-2)_100%)]" />

        {steps(base).map((step) => (
          <div className="relative mb-11" key={step.n}>
            <div className="absolute -left-14 top-0 grid h-9 w-9 place-items-center rounded-full border border-line-4 bg-panel font-mono text-[15px] text-dim">
              {step.n}
            </div>
            <div className="az-card p-6.5">
              <h2 className="mb-2.5 text-[26px] font-semibold tracking-[-.02em] text-fg">
                {step.title}
              </h2>
              <p className="mb-4.5 max-w-[560px] text-base leading-relaxed text-fg-2">
                {step.body}
              </p>
              <div className="flex flex-wrap gap-2.5">
                {step.actions.map((action) => (
                  <Link
                    className={`rounded-[9px] px-5 py-3 text-[15px] ${KIND[action.kind]}`}
                    href={action.href}
                    key={action.label}
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        ))}

        <div className="relative">
          <div className="absolute -left-14 top-0 grid h-9 w-9 place-items-center rounded-full border border-line-4 bg-panel font-mono text-[15px] text-dim">
            5
          </div>
          <div className="az-card-live p-6.5">
            <h2 className="mb-2.5 text-[26px] font-semibold tracking-[-.02em] text-fg">
              Then you just text it
            </h2>
            <p className="mb-5 max-w-[560px] text-base leading-relaxed text-fg-2">
              Ask about a lead, tell it to call someone, ask for a summary, or
              send a whole list out. It confirms before it dials.
            </p>

            <div className="mx-auto w-full max-w-[400px] rounded-[18px] border border-line-2 bg-field p-4">
              <div className="mb-4 flex items-center gap-2.5 border-b border-line pb-3">
                <span className="h-[7px] w-[7px] rounded-full bg-az" />
                <span className="font-mono text-[11px] tracking-[.12em] text-faint">
                  AGENTZERO
                </span>
              </div>
              <div className="grid gap-3">
                {TRANSCRIPT.map((line, index) => (
                  <div
                    className={`max-w-[85%] rounded-[14px] px-3.5 py-2.5 text-[14px] leading-snug ${
                      line.who === "you"
                        ? "ml-auto bg-az text-az-ink"
                        : "border border-line-2 bg-panel text-fg"
                    }`}
                    key={`${line.who}-${index}`}
                  >
                    {line.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-2 font-mono text-[13px] text-dim">
              {HELP_COMMANDS.map((command) => (
                <div key={command}>
                  <span className="text-az">›</span> {command}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}
