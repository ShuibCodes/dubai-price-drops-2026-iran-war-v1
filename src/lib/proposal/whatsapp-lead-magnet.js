import { getSupabaseServerClient, normalizeWaId } from "@/lib/supabase/server";
import { scrapeListingForProposal } from "@/lib/proposal/scrape-listing";
import {
  buildProposalPdfFilename,
  renderProposalPdfBuffer,
} from "@/lib/proposal/render-pdf";
import {
  sendWhatsAppMedia,
  sendWhatsAppText,
} from "@/lib/whatsapp/twilio-send";
import { sendProposalPdfEmail } from "@/lib/email/resend-client";

export const SIGNUP_URL = "https://www.agentzero.ae/get-started";
export const DAILY_FREE_PDF_LIMIT = 3;
export const PDF_BUCKET = "lead-magnet-pdfs";

export const DEFAULT_PROMPT_REPLY = `Send me a Property Finder link and your buyer or tenant's name and I'll make you a branded one-pager ("Prepared for …"). Want AgentZero to run your follow-ups too? Sign up here: ${SIGNUP_URL}`;

const EMAIL_RE = /\b([^\s@]+@[^\s@]+\.[^\s@]{2,})\b/i;
const URL_RE = /https?:\/\/[^\s<>)"']+/gi;

const GREETING_ONLY_RE =
  /^(hi+|hello+|hey+|salam|salaam|assalamu\s*alaikum|good\s*(morning|afternoon|evening)|yo|sup|test|testing|ok|okay|yes|no|thanks|thank\s*you|help|start|info|pdf|one\s*pager|one-pager)[!.?\s]*$/i;

const CANCEL_RE = /^(cancel|never\s*mind|nevermind|stop|skip|forget\s+it)[!.?\s]*$/i;

function getDubaiDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function extractListingUrlFromText(text) {
  const matches = String(text || "").match(URL_RE) || [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;!?)+]+$/, "");
    try {
      const parsed = new URL(cleaned);
      const host = parsed.hostname.toLowerCase();
      if (
        host.includes("propertyfinder.") ||
        host === "pf.ae" ||
        host.endsWith(".pf.ae") ||
        host.includes("bayut.") ||
        host.includes("dubizzle.")
      ) {
        return parsed.toString();
      }
    } catch {
      // ignore malformed URL
    }
  }
  return null;
}

export function extractEmailFromText(text) {
  const withoutUrls = String(text || "").replace(URL_RE, " ");
  const match = withoutUrls.match(EMAIL_RE);
  return match ? match[1].trim().toLowerCase() : null;
}

/**
 * Extracts the buyer/tenant's name ("Prepared for ...") from message text
 * after stripping any listing URLs and email addresses.
 */
export function parseClientName(rawText) {
  const stripped = String(rawText || "")
    .replace(URL_RE, " ")
    .replace(EMAIL_RE, " ")
    .replace(/\r/g, "")
    .trim();

  if (!stripped) return { clientName: "", companyName: "" };

  const lines = stripped
    .split("\n")
    .map((line) =>
      line
        .replace(/^[-•*]\s*/, "")
        .replace(
          /^(prepared\s+for|for\s+client|for\s+buyer|for\s+tenant|buyer\s*[:=-]?|tenant\s*[:=-]?|client\s*[:=-]?|name\s*[:=-]?|it's\s+for|its\s+for|for)\s+/i,
          ""
        )
        .replace(
          /\b(here\s+is\s+the\s+link|here's\s+the\s+link|please\s+make|make\s+me\s+a\s+one\s*pager|one\s*pager|property\s+finder|bayut)\b/gi,
          ""
        )
        .trim()
    )
    .filter(Boolean);

  if (lines.length === 0) return { clientName: "", companyName: "" };

  const joined = lines.join(" | ");
  if (GREETING_ONLY_RE.test(joined)) {
    return { clientName: "", companyName: "" };
  }

  let clientName = lines[0]
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^[,\-:|]+|[,\-:|.]+$/g, "")
    .trim();

  let companyName = "";
  const delimiterMatch = clientName.match(
    /^([^,|\-/]+?)(?:\s*(?:,|\||\/|\s-\s)\s*)(.+)$/i
  );
  if (delimiterMatch) {
    clientName = delimiterMatch[1].trim();
    companyName = delimiterMatch[2].trim();
  } else if (lines.length >= 2) {
    companyName = lines[1]
      .replace(/^(company|agency|brokerage)\s*[:=-]\s*/i, "")
      .trim();
  }

  if (
    !clientName ||
    clientName.length < 2 ||
    clientName.length > 60 ||
    GREETING_ONLY_RE.test(clientName) ||
    !/[a-zA-Z\u0600-\u06FF]/.test(clientName)
  ) {
    return { clientName: "", companyName: "" };
  }

  return {
    clientName,
    companyName: companyName.slice(0, 80),
  };
}

async function getOrCreateLeadMagnetUser(supabase, waId) {
  const today = getDubaiDateString();
  const { data: existing } = await supabase
    .from("whatsapp_lead_magnet_users")
    .select("*")
    .eq("wa_id", waId)
    .maybeSingle();

  if (existing) {
    if (existing.daily_date !== today) {
      const { data: resetRow } = await supabase
        .from("whatsapp_lead_magnet_users")
        .update({
          daily_date: today,
          daily_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("wa_id", waId)
        .select("*")
        .single();
      return resetRow || { ...existing, daily_date: today, daily_count: 0 };
    }
    return existing;
  }

  const { data: inserted } = await supabase
    .from("whatsapp_lead_magnet_users")
    .insert({
      wa_id: waId,
      daily_date: today,
      daily_count: 0,
      total_count: 0,
    })
    .select("*")
    .single();

  return (
    inserted || {
      wa_id: waId,
      agent_name: null,
      company_name: null,
      email: null,
      pending_listing_url: null,
      pending_client_name: null,
      last_client_name: null,
      last_pdf_url: null,
      last_pdf_storage_path: null,
      last_pdf_filename: null,
      last_listing_title: null,
      awaiting_email: false,
      daily_date: today,
      daily_count: 0,
      total_count: 0,
    }
  );
}

/**
 * Background worker that scrapes the listing, renders the PDF with "Prepared for [clientName]",
 * uploads it to Supabase Storage, sends it back on WhatsApp via Twilio mediaUrl,
 * and logs the lead. Also emails it immediately if the user included their email.
 */
export async function generateAndSendLeadMagnetPdf({
  waId,
  from,
  to,
  listingUrl,
  clientName,
  agentName = "",
  companyName,
  email,
  isRegisteredAgent = false,
}) {
  const supabase = getSupabaseServerClient();
  const formattedPhone = `+${waId}`;

  try {
    const listing = await scrapeListingForProposal(listingUrl);
    const enrichedListing = {
      ...listing,
      preparedFor: clientName,
      agentName: agentName || "",
      companyName: companyName || "",
      agentPhone: formattedPhone,
    };

    const pdfBuffer = await renderProposalPdfBuffer(enrichedListing);
    const filename = buildProposalPdfFilename(enrichedListing);
    const storagePath = `${waId}/${Date.now()}_${filename}`;

    if (!supabase) {
      throw new Error("Supabase client is not configured");
    }

    const { error: uploadError } = await supabase.storage
      .from(PDF_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from(PDF_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData?.publicUrl;
    if (!publicUrl) {
      throw new Error("Could not resolve public URL for generated PDF");
    }

    const today = getDubaiDateString();
    const user = await getOrCreateLeadMagnetUser(supabase, waId);
    const nextDailyCount =
      (user.daily_date === today ? Number(user.daily_count || 0) : 0) + 1;
    const nextTotalCount = Number(user.total_count || 0) + 1;

    await supabase
      .from("whatsapp_lead_magnet_users")
      .update({
        last_client_name: clientName,
        ...(companyName ? { company_name: companyName } : {}),
        ...(email ? { email } : {}),
        pending_listing_url: null,
        pending_client_name: null,
        last_pdf_url: publicUrl,
        last_pdf_storage_path: storagePath,
        last_pdf_filename: filename,
        last_listing_title: listing.title || "Property listing",
        awaiting_email: !email,
        daily_date: today,
        daily_count: nextDailyCount,
        total_count: nextTotalCount,
        updated_at: new Date().toISOString(),
      })
      .eq("wa_id", waId);

    // Log lead submission
    const { data: submission } = await supabase
      .from("lead_magnet_submissions")
      .insert({
        name: clientName || "WhatsApp Lead",
        client_name: clientName || null,
        email: email || user.email || null,
        phone: formattedPhone,
        company: companyName || user.company_name || null,
        listing_url: listingUrl,
        pdf_url: publicUrl,
        source: "whatsapp_az_number",
        email_status: email ? "pending" : "whatsapp_delivered",
        metadata: {
          wa_id: waId,
          prepared_for: clientName,
          community: listing.community || null,
          price: listing.price || null,
          title: listing.title || null,
          daily_count: nextDailyCount,
        },
      })
      .select("id")
      .single();

    // Send the PDF document on WhatsApp
    const signupTail = isRegisteredAgent
      ? ""
      : `\n\nWant AgentZero to run your follow-ups too? Sign up here: ${SIGNUP_URL}`;
    const caption = email
      ? `Here is your one-pager prepared for ${clientName}! I've also emailed a copy to ${email}.${signupTail}`
      : `Here is your one-pager prepared for ${clientName}!\n\nWant a copy by email too? Just reply with your email address.${signupTail}`;

    await sendWhatsAppMedia({
      to: from,
      from: to,
      body: caption,
      mediaUrl: [publicUrl],
    });

    if (email) {
      try {
        const emailRes = await sendProposalPdfEmail({
          to: email,
          agentName: clientName,
          listingTitle: `${listing.title || "Property listing"} (Prepared for ${clientName})`,
          pdfBuffer,
          pdfFilename: filename,
          pdfUrl: publicUrl,
        });
        if (submission?.id) {
          await supabase
            .from("lead_magnet_submissions")
            .update({
              email_status: "sent",
              resend_email_id: emailRes?.id || null,
              email_sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", submission.id);
        }
      } catch (emailErr) {
        console.error("[whatsapp-lead-magnet] Email send failed:", emailErr);
      }
    }
  } catch (error) {
    console.error("[whatsapp-lead-magnet] Generation failed:", error);
    try {
      await sendWhatsAppText({
        to: from,
        from: to,
        body: `Couldn't pull that listing right now (${error?.message || "scrape error"}). Make sure it's a live Property Finder or Bayut listing link and try again.`,
      });
    } catch (sendErr) {
      console.error("[whatsapp-lead-magnet] Error reply failed:", sendErr);
    }
  }
}

async function handleEmailCopyRequest({
  supabase,
  user,
  waId,
  from,
  to,
  email,
  isRegisteredAgent = false,
}) {
  try {
    let pdfBuffer = null;
    if (user.last_pdf_storage_path) {
      const { data: blob } = await supabase.storage
        .from(PDF_BUCKET)
        .download(user.last_pdf_storage_path);
      if (blob) {
        pdfBuffer = Buffer.from(await blob.arrayBuffer());
      }
    }

    const titleWithClient = user.last_client_name
      ? `${user.last_listing_title || "Property listing"} (Prepared for ${user.last_client_name})`
      : user.last_listing_title || "your listing";

    await sendProposalPdfEmail({
      to: email,
      agentName: user.last_client_name || "there",
      listingTitle: titleWithClient,
      pdfBuffer,
      pdfFilename: user.last_pdf_filename || "Property_one_pager.pdf",
      pdfUrl: user.last_pdf_url || "",
    });

    await supabase
      .from("whatsapp_lead_magnet_users")
      .update({
        email,
        awaiting_email: false,
        updated_at: new Date().toISOString(),
      })
      .eq("wa_id", waId);

    await supabase
      .from("lead_magnet_submissions")
      .update({
        email,
        email_status: "sent",
        email_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("phone", `+${waId}`)
      .eq("pdf_url", user.last_pdf_url);

    const signupTail = isRegisteredAgent
      ? ""
      : `\n\nWant AgentZero to run your follow-ups too? Sign up here: ${SIGNUP_URL}`;
    await sendWhatsAppText({
      to: from,
      from: to,
      body: `Sent! Check your inbox (${email}) for your one-pager PDF.${signupTail}`,
    });
  } catch (error) {
    console.error("[whatsapp-lead-magnet] Email copy failed:", error);
    await sendWhatsAppText({
      to: from,
      from: to,
      body: `Couldn't send the email right now, but you can download your PDF directly here: ${user.last_pdf_url}`,
    }).catch(() => {});
  }
}

/**
 * Handles an inbound WhatsApp message for the One-Pager PDF flow.
 * Works for both registered agents (`sender` provided — unlimited, falls back to Jarvis when `handled: false`)
 * and non-account users (`sender` null — capped at 3/day, replies with DEFAULT_PROMPT_REPLY when no link).
 * Returns `{ handled, replyText, backgroundPromise }`.
 */
export async function handleLeadMagnetInbound({
  from,
  to,
  body,
  callerWaId,
  sender = null,
}) {
  const isRegisteredAgent = Boolean(sender);
  const registeredAgentName = String(sender?.agentName || "").trim();
  const waId = normalizeWaId(callerWaId || sender?.waId || from);
  const supabase = getSupabaseServerClient();

  const listingUrl = extractListingUrlFromText(body);
  const email = extractEmailFromText(body);
  const { clientName: parsedClientName, companyName: parsedCompany } =
    parseClientName(body);

  if (!supabase) {
    if (!listingUrl) {
      return {
        handled: !isRegisteredAgent,
        replyText: isRegisteredAgent ? "" : DEFAULT_PROMPT_REPLY,
        backgroundPromise: null,
      };
    }
    if (!parsedClientName) {
      return {
        handled: true,
        replyText:
          'Got the link! What is the buyer or tenant\'s name so I can put "Prepared for …" on the PDF?',
        backgroundPromise: null,
      };
    }
    return {
      handled: true,
      replyText: `Building your one-pager (Prepared for ${parsedClientName}) — takes about 20 seconds…`,
      backgroundPromise: generateAndSendLeadMagnetPdf({
        waId,
        from,
        to,
        listingUrl,
        clientName: parsedClientName,
        agentName: registeredAgentName,
        companyName: parsedCompany || "",
        email,
        isRegisteredAgent,
      }),
    };
  }

  // Fast path for registered agents: if they didn't send a listing URL, check if they have
  // an active one-pager state (pending_listing_url or awaiting_email + email in message).
  if (isRegisteredAgent && !listingUrl) {
    const { data: existingUser } = await supabase
      .from("whatsapp_lead_magnet_users")
      .select("*")
      .eq("wa_id", waId)
      .maybeSingle();

    const hasPendingUrl = Boolean(existingUser?.pending_listing_url);
    const isEmailReply = Boolean(
      email &&
        existingUser?.awaiting_email &&
        existingUser?.last_pdf_url &&
        String(body || "").trim().split(/\s+/).length <= 6
    );

    if (!hasPendingUrl && !isEmailReply) {
      return { handled: false, replyText: "", backgroundPromise: null };
    }

    if (hasPendingUrl && CANCEL_RE.test(String(body || "").trim())) {
      await supabase
        .from("whatsapp_lead_magnet_users")
        .update({
          pending_listing_url: null,
          pending_client_name: null,
          updated_at: new Date().toISOString(),
        })
        .eq("wa_id", waId);
      return {
        handled: true,
        replyText: "Cancelled the one-pager.",
        backgroundPromise: null,
      };
    }
  }

  const user = await getOrCreateLeadMagnetUser(supabase, waId);

  // 1. If they replied with their email address after receiving a PDF (and didn't send a new link)
  if (email && !listingUrl && user.last_pdf_url && (!isRegisteredAgent || user.awaiting_email)) {
    return {
      handled: true,
      replyText: `Sending a copy of your one-pager to ${email}…`,
      backgroundPromise: handleEmailCopyRequest({
        supabase,
        user,
        waId,
        from,
        to,
        email,
        isRegisteredAgent,
      }),
    };
  }

  // 2. If they sent a Property Finder / Bayut link
  if (listingUrl) {
    if (!isRegisteredAgent && Number(user.daily_count || 0) >= DAILY_FREE_PDF_LIMIT) {
      return {
        handled: true,
        replyText: `You've used your ${DAILY_FREE_PDF_LIMIT} free one-pagers for today. Want AgentZero to run your follow-ups too? Sign up here: ${SIGNUP_URL}`,
        backgroundPromise: null,
      };
    }

    const effectiveClientName =
      parsedClientName || (!isRegisteredAgent ? user.pending_client_name : "") || "";
    const effectiveCompany = parsedCompany || user.company_name || "";

    // Require the buyer/tenant's name for "Prepared for ..." on every PDF
    if (!effectiveClientName) {
      await supabase
        .from("whatsapp_lead_magnet_users")
        .update({
          pending_listing_url: listingUrl,
          ...(registeredAgentName ? { agent_name: registeredAgentName } : {}),
          ...(email ? { email } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("wa_id", waId);

      return {
        handled: true,
        replyText:
          'Got the link! What is the buyer or tenant\'s name so I can put "Prepared for …" on the PDF?',
        backgroundPromise: null,
      };
    }

    // We have both the link and the buyer/tenant's name — start building the PDF!
    await supabase
      .from("whatsapp_lead_magnet_users")
      .update({
        last_client_name: effectiveClientName,
        ...(registeredAgentName ? { agent_name: registeredAgentName } : {}),
        ...(effectiveCompany ? { company_name: effectiveCompany } : {}),
        ...(email ? { email } : {}),
        pending_listing_url: null,
        pending_client_name: null,
        updated_at: new Date().toISOString(),
      })
      .eq("wa_id", waId);

    return {
      handled: true,
      replyText: `Building your one-pager (Prepared for ${effectiveClientName}) — takes about 20 seconds…`,
      backgroundPromise: generateAndSendLeadMagnetPdf({
        waId,
        from,
        to,
        listingUrl,
        clientName: effectiveClientName,
        agentName: registeredAgentName,
        companyName: effectiveCompany,
        email: email || null,
        isRegisteredAgent,
      }),
    };
  }

  // 3. No link in this message, but we were waiting for the buyer/tenant's name for a pending link
  if (user.pending_listing_url && parsedClientName) {
    if (!isRegisteredAgent && Number(user.daily_count || 0) >= DAILY_FREE_PDF_LIMIT) {
      return {
        handled: true,
        replyText: `You've used your ${DAILY_FREE_PDF_LIMIT} free one-pagers for today. Want AgentZero to run your follow-ups too? Sign up here: ${SIGNUP_URL}`,
        backgroundPromise: null,
      };
    }

    const pendingUrl = user.pending_listing_url;
    const effectiveCompany = parsedCompany || user.company_name || "";

    await supabase
      .from("whatsapp_lead_magnet_users")
      .update({
        last_client_name: parsedClientName,
        ...(registeredAgentName ? { agent_name: registeredAgentName } : {}),
        ...(effectiveCompany ? { company_name: effectiveCompany } : {}),
        ...(email ? { email } : {}),
        pending_listing_url: null,
        pending_client_name: null,
        updated_at: new Date().toISOString(),
      })
      .eq("wa_id", waId);

    return {
      handled: true,
      replyText: `Building your one-pager (Prepared for ${parsedClientName}) — takes about 20 seconds…`,
      backgroundPromise: generateAndSendLeadMagnetPdf({
        waId,
        from,
        to,
        listingUrl: pendingUrl,
        clientName: parsedClientName,
        agentName: registeredAgentName,
        companyName: effectiveCompany,
        email: email || null,
        isRegisteredAgent,
      }),
    };
  }

  if (user.pending_listing_url && !parsedClientName) {
    return {
      handled: true,
      replyText:
        'What is the buyer or tenant\'s name so I can put "Prepared for …" on the PDF for that listing?',
      backgroundPromise: null,
    };
  }

  if (isRegisteredAgent) {
    return { handled: false, replyText: "", backgroundPromise: null };
  }

  // 4. Everything else from a non-account number gets the prompt + sign-up link
  // (If they happened to type a buyer name first before pasting the link, remember it!)
  if (parsedClientName) {
    await supabase
      .from("whatsapp_lead_magnet_users")
      .update({
        pending_client_name: parsedClientName,
        updated_at: new Date().toISOString(),
      })
      .eq("wa_id", waId);
  }

  return {
    handled: true,
    replyText: DEFAULT_PROMPT_REPLY,
    backgroundPromise: null,
  };
}
