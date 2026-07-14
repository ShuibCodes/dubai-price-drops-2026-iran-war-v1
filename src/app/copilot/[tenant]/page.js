"use client";

import { useState } from "react";

export default function CopilotPage({ params }) {
  const tenant = params.tenant;
  const [agentName, setAgentName] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi — ask me about calls, callbacks, leads, or today’s activity.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const response = await fetch(`/api/copilot/${encodeURIComponent(tenant)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          agentName: agentName.trim() || "Web agent",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Copilot request failed");
      setMessages((current) => [
        ...current,
        { role: "assistant", content: body.message },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `Error: ${error.message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <section className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        <header className="border-b border-slate-800 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                Operations Copilot
              </p>
              <h1 className="mt-1 text-lg font-semibold">{tenant}</h1>
            </div>
            <input
              aria-label="Your name"
              className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="Your name"
              value={agentName}
            />
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
          {messages.map((message, index) => (
            <div
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              key={`${message.role}-${index}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-800 text-slate-100"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="text-sm text-slate-400">Copilot is checking…</div>
          ) : null}
        </div>

        <form className="border-t border-slate-800 p-4" onSubmit={submit}>
          <div className="flex gap-3">
            <input
              aria-label="Message"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-emerald-500"
              disabled={sending}
              onChange={(event) => setInput(event.target.value)}
              placeholder="How many calls did we make today?"
              value={input}
            />
            <button
              className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={sending || !input.trim()}
              type="submit"
            >
              Send
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
