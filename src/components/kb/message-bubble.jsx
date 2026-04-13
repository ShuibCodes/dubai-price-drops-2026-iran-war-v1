"use client";

function formatMarkdown(text) {
  let html = text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-white/10 px-1 py-0.5 rounded text-xs">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-white mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-semibold text-white text-lg mt-4 mb-1">$1</h2>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, "<br/>");

  return html;
}

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
          isUser
            ? "bg-[#c8a55e] text-black rounded-br-md"
            : "bg-white/[0.06] border border-white/10 text-white/90 rounded-bl-md"
        }`}
      >
        {isUser ? (
          <p className="text-sm leading-relaxed">{message.content}</p>
        ) : (
          <div
            className="text-sm leading-relaxed prose-invert [&_li]:my-0.5 [&_strong]:text-white [&_code]:text-amber-300"
            dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
          />
        )}
      </div>
    </div>
  );
}
