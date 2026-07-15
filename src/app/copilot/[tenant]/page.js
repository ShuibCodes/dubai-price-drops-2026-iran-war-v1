"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

const markdownComponents = {
  p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  strong: (props) => <strong className="font-semibold text-white" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  ul: (props) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />
  ),
  ol: (props) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />
  ),
  li: (props) => <li className="leading-6" {...props} />,
  code: (props) => (
    <code
      className="rounded bg-slate-950/60 px-1.5 py-0.5 font-mono text-[0.8rem] text-emerald-300"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="my-2 overflow-x-auto rounded-lg bg-slate-950/60 p-3 text-[0.8rem] first:mt-0 last:mb-0"
      {...props}
    />
  ),
  h1: (props) => <h3 className="my-2 font-semibold text-white first:mt-0" {...props} />,
  h2: (props) => <h3 className="my-2 font-semibold text-white first:mt-0" {...props} />,
  h3: (props) => <h3 className="my-2 font-semibold text-white first:mt-0" {...props} />,
  a: (props) => (
    <a
      className="text-emerald-400 underline underline-offset-2"
      rel="noopener noreferrer"
      target="_blank"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-2 border-l-2 border-slate-600 pl-3 text-slate-300 first:mt-0 last:mb-0"
      {...props}
    />
  ),
  hr: () => <hr className="my-3 border-slate-700" />,
  table: (props) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table
        className="w-full border-collapse overflow-hidden rounded-lg text-left text-[0.8rem]"
        {...props}
      />
    </div>
  ),
  thead: (props) => <thead className="bg-slate-900/60" {...props} />,
  th: (props) => (
    <th
      className="border border-slate-700 px-3 py-2 font-semibold text-slate-200"
      {...props}
    />
  ),
  td: (props) => (
    <td className="border border-slate-700 px-3 py-2 text-slate-300" {...props} />
  ),
};

function AssistantMessage({ content }) {
  return (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={[remarkGfm, remarkBreaks]}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  );
}

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

  async function logout() {
    try {
      await fetch("/api/copilot/auth", { method: "DELETE" });
    } catch {
      // Ignore network errors; redirect to login regardless.
    }
    window.location.href = "/copilot/login";
  }

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
      if (response.status === 401) {
        window.location.href = `/copilot/login?next=/copilot/${encodeURIComponent(tenant)}`;
        return;
      }
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
            <div className="flex items-center gap-3">
              <input
                aria-label="Your name"
                className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                onChange={(event) => setAgentName(event.target.value)}
                placeholder="Your name"
                value={agentName}
              />
              <button
                className="text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
                onClick={logout}
                type="button"
              >
                Log out
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
          {messages.map((message, index) => (
            <div
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              key={`${message.role}-${index}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "whitespace-pre-wrap bg-emerald-500 text-slate-950"
                    : "bg-slate-800 text-slate-100"
                }`}
              >
                {message.role === "user" ? (
                  message.content
                ) : (
                  <AssistantMessage content={message.content} />
                )}
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
