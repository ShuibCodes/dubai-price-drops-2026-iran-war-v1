import Anthropic from "@anthropic-ai/sdk";
import { getLeadStory, searchLeadByName } from "@/lib/copilot/tools";
import { sendLeadEmail } from "@/lib/email/resend-client";

const MODEL = "claude-sonnet-4-6";

function clean(value) {
  return String(value ?? "").trim();
}

function parseEmail(text) {
  const match = String(text ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function formatThread(events = []) {
  return events
    .filter((event) => event.type === "message" && event.body)
    .slice(-20)
    .map((event) => {
      const who = event.direction === "outbound" ? "me" : "lead";
      return `${who}: ${event.body}`;
    })
    .join("\n");
}

async function resolveLead(tenantId, { leadId, name }) {
  if (leadId) {
    const story = await getLeadStory(tenantId, leadId);
    if (!story?.lead) throw new Error("Lead not found");
    return story;
  }

  const matches = await searchLeadByName(tenantId, name);
  if (!matches.length) throw new Error(`No lead found matching "${name}"`);
  if (matches.length > 1) {
    return {
      ambiguous: true,
      matches: matches.map((lead) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        messageCount: lead.messageCount,
      })),
    };
  }

  return getLeadStory(tenantId, matches[0].id);
}

export async function draftLeadEmail(tenantId, { leadId, name, to, subject, body, intent }) {
  const resolved = await resolveLead(tenantId, { leadId, name });
  if (resolved?.ambiguous) return resolved;

  const lead = resolved.lead;
  const thread = formatThread(resolved.events);
  const recipient = clean(to) || parseEmail(thread) || parseEmail(intent);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let draftSubject = clean(subject);
  let draftBody = clean(body);

  if ((!draftSubject || !draftBody) && apiKey) {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system:
        "You draft short professional real-estate emails. Return JSON only with keys subject and body. No markdown fences. Keep body under 120 words. No em dashes.",
      messages: [
        {
          role: "user",
          content: `Lead: ${lead.name || "there"}
Phone: ${lead.phone || "unknown"}
User request: ${clean(intent) || "Follow up on our WhatsApp conversation."}

Recent WhatsApp thread:
${thread || "(no recent messages)"}

Write subject + body. If an email address appears in the thread, you may mention it but do not invent one.`,
        },
      ],
    });

    const raw = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");

    try {
      const parsed = JSON.parse(raw);
      draftSubject = draftSubject || clean(parsed.subject);
      draftBody = draftBody || clean(parsed.body);
    } catch {
      // Fall through to template below.
    }
  }

  if (!draftSubject) {
    draftSubject = `Following up — ${lead.name || "your property search"}`;
  }
  if (!draftBody) {
    const firstName = clean(lead.name).split(/\s+/)[0] || "there";
    draftBody = [
      `Hi ${firstName},`,
      "",
      "Following up on our WhatsApp chat. Happy to share options or book a call whenever it suits you.",
      "",
      "Best regards",
    ].join("\n");
  }

  return {
    leadId: lead.id,
    leadName: lead.name,
    phone: lead.phone,
    to: recipient || null,
    subject: draftSubject.replace(/—/g, "-"),
    body: draftBody.replace(/—/g, "-"),
    missingEmail: !recipient,
  };
}

export async function sendDraftEmail({ to, subject, body }) {
  if (!to) throw new Error("Missing recipient email");
  if (!subject || !body) throw new Error("Missing subject or body");
  const result = await sendLeadEmail({ to, subject, body, metadata: { source: "jarvis" } });
  return { ok: true, id: result?.id || null, to, subject };
}
