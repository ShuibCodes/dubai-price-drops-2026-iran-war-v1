"use client";

import { useMemo, useRef, useState } from "react";

function Avatar({ label, color = "#374248" }) {
  return (
    <div
      className="h-12 w-12 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold text-white/90"
      style={{ backgroundColor: color }}
    >
      {label}
    </div>
  );
}

export default function ChatInterface() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef(null);

  const leftChats = useMemo(
    () => [
      { name: "+971 58 742 1936", preview: "Salam, can we review the floor plan?", time: "Yesterday", unread: 2, initials: "58", color: "#8f6e63" },
      { name: "Yousef Al-Hammadi", preview: "Can we renegotiate the price?", time: "Yesterday", unread: 4, initials: "YA", color: "#766b52" },
      { name: "+971 56 918 4472", preview: "Need moving date confirmed", time: "30/03/2026", unread: 1, initials: "56", color: "#4e6f78" },
      { name: "AgentZero (AI)", preview: "Wa alaykumsalam. I can map next steps.", time: "10:22", unread: 0, active: true, initials: "AZ", color: "#5a4c7a" },
      { name: "+971 50 331 8804", preview: "Any update on the payment plan?", time: "10:22", unread: 7, initials: "50", color: "#4f5f77" },
      { name: "Anastasia Volkova", preview: "School distance is our priority", time: "10:17", unread: 3, initials: "AV", color: "#7b5f58" },
      { name: "+971 55 274 6198", preview: "Do you have distressed options?", time: "09:29", unread: 5, initials: "55", color: "#586b54" },
      { name: "Oliver Bennett", preview: "Let's schedule another viewing", time: "09:23", unread: 0, initials: "OB", color: "#5f5a7a" },
      { name: "+971 54 889 2031", preview: "Can I buy remotely from abroad?", time: "09:07", unread: 0, initials: "54", color: "#51696b" },
      { name: "+971 52 610 7745", preview: "Please share service charge details", time: "08:47", unread: 2, initials: "52", color: "#705b53" },
      { name: "+971 57 403 9920", preview: "I'll circle back next week", time: "08:40", unread: 0, initials: "57", color: "#4f6e62" },
    ],
    []
  );

  async function onSend(source = "unknown") {
    // #region agent log
    fetch('http://127.0.0.1:7745/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8dd901'},body:JSON.stringify({sessionId:'8dd901',runId:'pre-fix',hypothesisId:'H1',location:'src/components/kb/chat-interface.jsx:onSend:entry',message:'onSend invoked',data:{source,inputLength:input.length,isStreaming,messageCount:messages.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const text = input.trim();
    if (!text || isStreaming) {
      // #region agent log
      fetch('http://127.0.0.1:7745/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8dd901'},body:JSON.stringify({sessionId:'8dd901',runId:'pre-fix',hypothesisId:'H2',location:'src/components/kb/chat-interface.jsx:onSend:guard',message:'onSend guard return',data:{source,reason:!text?'empty_text':'streaming_true',trimmedLength:text.length,isStreaming},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return;
    }

    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const userMessage = { role: "self", text, time: now };
    const historyForApi = [...messages, userMessage].map((m) => ({
      role: m.role === "self" ? "user" : "assistant",
      content: m.text,
    }));

    setMessages((prev) => [...prev, userMessage, { role: "other", text: "", time: now }]);
    setInput("");
    setIsStreaming(true);

    try {
      // #region agent log
      fetch('http://127.0.0.1:7745/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8dd901'},body:JSON.stringify({sessionId:'8dd901',runId:'pre-fix',hypothesisId:'H3',location:'src/components/kb/chat-interface.jsx:onSend:beforeFetch',message:'sending request to api',data:{historyCount:historyForApi.length,lastUserTextLength:text.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const response = await fetch("/api/kb/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyForApi }),
      });

      // #region agent log
      fetch('http://127.0.0.1:7745/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8dd901'},body:JSON.stringify({sessionId:'8dd901',runId:'pre-fix',hypothesisId:'H4',location:'src/components/kb/chat-interface.jsx:onSend:afterFetch',message:'api response received',data:{ok:response.ok,status:response.status,hasBody:Boolean(response.body)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response stream");
      }

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              accumulated += parsed.text;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  text: accumulated,
                };
                return next;
              });
            }
            if (parsed.error) throw new Error(parsed.error);
          } catch (err) {
            if (err?.message !== "Unexpected end of JSON input") {
              throw err;
            }
          }
        }
      }
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7745/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8dd901'},body:JSON.stringify({sessionId:'8dd901',runId:'pre-fix',hypothesisId:'H5',location:'src/components/kb/chat-interface.jsx:onSend:catch',message:'onSend failed',data:{errorMessage:error?.message||'unknown_error'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "other",
          text: `Something went wrong: ${error.message}. Please try again.`,
          time: now,
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-[#0b141a] text-[#e9edef]">
      <div className="h-full flex">
        <aside className="w-[60px] bg-[#202c33] border-r border-black/40 flex flex-col items-center py-3">
          <button className="h-10 w-10 rounded-full bg-[#111b21] grid place-items-center text-[#aebac1] text-sm">W</button>
          <button className="mt-3 h-10 w-10 rounded-full bg-[#00a884] text-[#111b21] font-bold text-sm">326</button>
          <button className="mt-3 h-10 w-10 rounded-full bg-[#111b21] grid place-items-center text-[#8696a0] text-sm">C</button>
          <button className="mt-3 h-10 w-10 rounded-full bg-[#111b21] grid place-items-center text-[#8696a0] text-sm">S</button>
          <div className="mt-auto flex flex-col items-center gap-3">
            <button className="h-10 w-10 rounded-full bg-[#111b21] grid place-items-center text-[#8696a0] text-sm">*</button>
            <button className="h-10 w-10 rounded-full bg-[#111b21] grid place-items-center text-[#8696a0] text-sm">O</button>
          </div>
        </aside>

        <aside className="w-[350px] bg-[#111b21] border-r border-black/40 flex flex-col">
          <div className="h-[59px] px-4 flex items-center justify-between border-b border-[#202c33]">
            <p className="text-[20px] font-medium text-[#e9edef]">Chats</p>
            <button className="text-[#8696a0] text-lg">✎</button>
          </div>

          <div className="px-3 py-2 border-b border-[#202c33]">
            <div className="h-9 rounded-lg bg-[#202c33] flex items-center px-3 text-[13px] text-[#8696a0]">
              Search
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {leftChats.map((chat) => (
              <div
                key={chat.name}
                className={`h-[72px] px-3 flex items-center gap-3 border-b border-black/10 ${
                  chat.active ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
                }`}
              >
                <Avatar label={chat.initials} color={chat.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] leading-5 text-[#e9edef]">{chat.name}</p>
                    <span className="text-[12px] text-[#8696a0]">{chat.time}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] text-[#8696a0]">{chat.preview}</p>
                    {chat.unread > 0 ? (
                      <span className="min-w-5 h-5 px-1 rounded-full bg-[#00a884] text-[#0b141a] text-[11px] font-semibold grid place-items-center">
                        {chat.unread}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 flex flex-col bg-[#0b141a]">
          <header className="h-[59px] bg-[#202c33] border-b border-black/40 px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar label="AZ" color="#5a4c7a" />
              <div>
                <p className="text-[16px] leading-5 text-[#e9edef]">AgentZero</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[#aebac1]">
              <button className="h-8 px-4 rounded border border-[#3b4a54] text-[13px]">Call</button>
              <button className="h-8 w-8 rounded hover:bg-[#2a3942]">⌄</button>
            </div>
          </header>

          <section
            className="flex-1 overflow-y-auto px-[72px] py-6"
            style={{
              backgroundColor: "#0b141a",
              backgroundImage:
                "radial-gradient(circle at 12px 12px, rgba(255,255,255,0.022) 1px, transparent 0), radial-gradient(circle at 52px 52px, rgba(255,255,255,0.018) 1px, transparent 0)",
              backgroundSize: "64px 64px",
            }}
          >
            <div className="mx-auto max-w-[760px]">
              {messages.length === 0 ? (
                <div className="h-full min-h-[300px] grid place-items-center text-[#8696a0] text-sm">
                  Ask AgentZero anything about your knowledge base.
                </div>
              ) : null}

              {messages.map((msg, idx) => (
                <div
                  key={`${msg.time}-${idx}`}
                  className={`mb-2 flex ${msg.role === "self" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[620px] rounded-[8px] px-3 py-1.5 text-[14px] leading-[19px] shadow-[0_1px_0_rgba(11,20,26,.4)] ${
                      msg.role === "self"
                        ? "bg-[#005c4b] rounded-tr-sm"
                        : "bg-[#202c33] rounded-tl-sm"
                    }`}
                  >
                    <p>{msg.text}</p>
                    <div className="mt-1 flex justify-end items-center gap-1 text-[11px] text-[#8696a0]">
                      {msg.edited ? <span>Edited</span> : null}
                      <span>{msg.time}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </section>

          <footer className="h-[62px] bg-[#202c33] border-t border-black/30 px-4 flex items-center gap-3">
            <button className="h-8 w-8 text-[#8696a0] text-lg">+</button>
            <div className="h-10 flex-1 rounded-lg bg-[#2a3942] px-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSend("enter");
                }}
                placeholder="Type a message"
                className="h-full w-full bg-transparent text-[14px] text-[#d1d7db] placeholder:text-[#8696a0] outline-none"
              />
            </div>
            <button className="h-8 w-8 text-[#8696a0]" aria-label="send" onClick={() => onSend("button")}>
              ➤
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}
