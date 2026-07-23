"use client";

import { useEffect, useRef, useState } from "react";
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
      className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[0.8rem] text-amber-200"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="my-2 overflow-x-auto rounded-lg bg-black/40 p-3 text-[0.8rem] first:mt-0 last:mb-0"
      {...props}
    />
  ),
  h1: (props) => <h3 className="my-2 font-semibold text-white first:mt-0" {...props} />,
  h2: (props) => <h3 className="my-2 font-semibold text-white first:mt-0" {...props} />,
  h3: (props) => <h3 className="my-2 font-semibold text-white first:mt-0" {...props} />,
  a: (props) => (
    <a
      className="text-amber-300 underline underline-offset-2"
      rel="noopener noreferrer"
      target="_blank"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-2 border-l-2 border-white/20 pl-3 text-white/70 first:mt-0 last:mb-0"
      {...props}
    />
  ),
  hr: () => <hr className="my-3 border-white/10" />,
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

const WELCOME =
  "Jarvis online — your live WhatsApp KB. Ask about chats, call someone (Vapi), or draft an email. Calls and sends need your yes.";

export default function JarvisPage() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: WELCOME },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("jarvis_key");
    if (stored) setAccessKey(stored);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function submit(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const headers = { "Content-Type": "application/json" };
      if (accessKey) headers["x-jarvis-key"] = accessKey;
      const response = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ messages: nextMessages }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setNeedsKey(true);
        throw new Error("Access key required — enter it below and resend.");
      }
      setNeedsKey(false);
      if (!response.ok) throw new Error(body.error || "Jarvis request failed");
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
    <main className="min-h-screen bg-[#0b0c10] px-4 py-8 text-[#e8e6e1]">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(212,175,55,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(40,60,90,0.25),_transparent_50%)]"
      />
      <section className="relative mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12141a]/90 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur">
        <header className="border-b border-white/10 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-300/90">
            Live WhatsApp KB
          </p>
          <h1 className="mt-1 font-serif text-2xl tracking-tight text-white">Jarvis</h1>
          <p className="mt-1 text-sm text-white/50">
            Continuous WhatsApp ingest · Vapi calls · Resend email
          </p>
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
                    ? "whitespace-pre-wrap bg-amber-400 text-[#12141a]"
                    : "border border-white/10 bg-white/5 text-[#e8e6e1]"
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
            <div className="text-sm text-white/40">Jarvis is thinking…</div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <form className="border-t border-white/10 p-4" onSubmit={submit}>
          {needsKey ? (
            <div className="mb-3">
              <input
                aria-label="Access key"
                className="w-full rounded-xl border border-amber-400/40 bg-black/30 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400"
                onChange={(event) => {
                  const value = event.target.value.trim();
                  setAccessKey(value);
                  window.localStorage.setItem("jarvis_key", value);
                }}
                placeholder="Access key"
                type="password"
                value={accessKey}
              />
            </div>
          ) : null}
          <div className="flex gap-3">
            <input
              aria-label="Message Jarvis"
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
              disabled={sending}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about a chat, or say call / email someone…"
              value={input}
            />
            <button
              className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-[#12141a] transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
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
