const MESSAGES = [
  {
    id: "user-1",
    from: "user",
    text: "Anyone gone cold I should chase?",
    time: "09:41",
    read: true,
  },
  {
    id: "agent-1",
    from: "agent",
    text: "Checking through your conversations...",
    time: "09:41",
  },
  {
    id: "agent-2",
    from: "agent",
    text: "Sara Khan viewed Marina Gate twice then went quiet 3 weeks ago. Want me to call her and send the new 2-bed listing?",
    time: "09:42",
  },
];

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
      <path
        d="M15 5 8 12l7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M15.5 10.2 21 7.4v9.2l-5.5-2.8v-3.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" aria-hidden="true">
      <path
        d="M7.2 3.8h2.4l1.2 3-1.6 1.1a12.5 12.5 0 0 0 5.7 5.7l1.1-1.6 3 1.2v2.4c0 .7-.6 1.4-1.3 1.5-7.4.8-13.6-5.4-12.8-12.8.1-.7.8-1.3 1.5-1.3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMore() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="6" r="1.35" />
      <circle cx="12" cy="12" r="1.35" />
      <circle cx="12" cy="18" r="1.35" />
    </svg>
  );
}

function IconRead() {
  return (
    <svg viewBox="0 0 16 10" className="h-[9px] w-[14px]" fill="none" aria-hidden="true">
      <path d="M1 5.2 3.8 8 10.4 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.2 5.4 8.4 8 15 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignalIcons() {
  return (
    <div className="flex items-center gap-[5px] text-white">
      <svg viewBox="0 0 18 12" className="h-[11px] w-[17px]" fill="currentColor" aria-hidden="true">
        <rect x="0" y="8" width="3" height="4" rx="0.6" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="0.6" />
        <rect x="10" y="3" width="3" height="9" rx="0.6" />
        <rect x="15" y="0" width="3" height="12" rx="0.6" opacity="0.35" />
      </svg>
      <svg viewBox="0 0 16 12" className="h-[11px] w-[15px]" fill="currentColor" aria-hidden="true">
        <path d="M8 3.2c2.1 0 4 .8 5.5 2.1l1.1-1.2C12.8 2.4 10.5 1.4 8 1.4S3.2 2.4 1.4 4.1l1.1 1.2C4 4 5.9 3.2 8 3.2Zm0 3.1c1.2 0 2.3.5 3.1 1.2l1.1-1.2A6.3 6.3 0 0 0 8 4.8 6.3 6.3 0 0 0 3.8 6.3l1.1 1.2A4.3 4.3 0 0 1 8 6.3Zm0 3.2c.6 0 1.1.2 1.5.6L8 11.6 6.5 10.1c.4-.4.9-.6 1.5-.6Z" />
      </svg>
      <svg viewBox="0 0 27 12" className="h-[11px] w-[25px]" fill="currentColor" aria-hidden="true">
        <rect x="0" y="1" width="22" height="10" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <rect x="2" y="3" width="16" height="6" rx="1" />
        <rect x="23.2" y="4" width="2.2" height="4" rx="0.7" />
      </svg>
    </div>
  );
}

function ChatBubble({ message }) {
  const isUser = message.from === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[84%] rounded-[18px] px-3.5 py-2.5 ${
          isUser ? "rounded-br-[6px] bg-[#262626]" : "rounded-bl-[6px] bg-[#2c2c2e]"
        }`}
      >
        <p className="font-mono text-[13px] font-medium leading-[1.45] tracking-[-0.02em] text-white">
          {message.text}
        </p>
        <div
          className={`mt-1.5 flex items-center gap-1 ${
            isUser ? "justify-end text-white/50" : "justify-end text-white/40"
          }`}
        >
          <span className="font-mono text-[10px] tabular-nums">{message.time}</span>
          {message.read ? <IconRead /> : null}
        </div>
      </div>
    </div>
  );
}

export function CopilotLoginPreview() {
  return (
    <aside className="relative hidden min-h-0 overflow-hidden bg-background lg:flex lg:flex-col">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(255,45,85,0.22),rgba(0,229,255,0.08)_42%,transparent_68%)]"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-10 py-8">
        <div
          className="relative flex h-[min(38rem,calc(100dvh-15rem))] w-[min(21.5rem,68%)] flex-col overflow-hidden rounded-[2.5rem] border-[6px] border-[#111] bg-black shadow-[0_24px_70px_rgba(0,0,0,0.35)]"
          aria-hidden="true"
        >
          <div className="relative z-20 flex items-end justify-between px-5 pb-0.5 pt-2.5 text-[12px] font-semibold text-white">
            <span className="w-10 font-mono tabular-nums">9:41</span>
            <span className="absolute left-1/2 top-2 h-[21px] w-[86px] -translate-x-1/2 rounded-full bg-black" />
            <SignalIcons />
          </div>

          <header className="flex items-center gap-1 px-1.5 pb-2.5 pt-1.5">
            <span className="flex h-8 w-7 items-center justify-center text-white">
              <IconBack />
            </span>
            <div className="relative mr-1 h-8 w-8 shrink-0">
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[#2a2a2a] font-mono text-[10px] font-semibold tracking-wide text-white">
                AZ
              </div>
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-[1.5px] border-black bg-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[14px] font-semibold leading-none text-white">
                AgentZero
              </p>
              <p className="mt-1 truncate font-mono text-[10px] leading-none text-white/45">
                online · assisting
              </p>
            </div>
            <div className="flex items-center gap-2.5 pr-2 text-white">
              <IconVideo />
              <IconPhone />
              <IconMore />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-3 pt-1">
            <div className="mb-0.5 flex justify-center">
              <span className="rounded-full bg-[#1c1c1e] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
                Today
              </span>
            </div>
            {MESSAGES.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}
          </div>

          <div className="flex justify-center pb-2.5 pt-2">
            <div className="h-[4px] w-[108px] rounded-full bg-white/35" />
          </div>
        </div>

        <div className="mt-7 max-w-md text-center text-white">
          <h2 className="text-[1.55rem] font-semibold leading-tight tracking-tight">
            Chase the leads that went quiet.
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-white/85">
            AgentZero reads your chats and tells you who to call — before they go cold.
          </p>
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center justify-center gap-2 pb-6" aria-hidden="true">
        <span className="h-2 w-2 rounded-full bg-white" />
        <span className="h-2 w-2 rounded-full bg-white/35" />
        <span className="h-2 w-2 rounded-full bg-white/35" />
      </div>
    </aside>
  );
}
