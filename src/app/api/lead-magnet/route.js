import { NextResponse } from "next/server";
import { sendLeadMagnetEmail } from "@/lib/email/resend-client";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const source =
    typeof body?.source === "string" && body.source.trim()
      ? body.source.trim()
      : "landing_popup_one_pager";

  if (!name) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 500 }
    );
  }

  const userAgent = request.headers.get("user-agent") || null;
  const referer = request.headers.get("referer") || null;

  // 1. Persist lead in Supabase first
  const { data: submission, error: insertError } = await supabase
    .from("lead_magnet_submissions")
    .insert({
      name,
      email,
      source,
      email_status: "pending",
      metadata: {
        user_agent: userAgent,
        referer,
      },
    })
    .select("id, name, email, created_at")
    .single();

  if (insertError || !submission) {
    return NextResponse.json(
      { error: insertError?.message || "Failed to save submission." },
      { status: 500 }
    );
  }

  // 2. Trigger Resend email using the persisted name & email
  try {
    const emailResult = await sendLeadMagnetEmail({
      name: submission.name,
      email: submission.email,
    });

    await supabase
      .from("lead_magnet_submissions")
      .update({
        email_status: "sent",
        resend_email_id: emailResult?.id || null,
        resend_template_id: emailResult?.templateId || null,
        email_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.id);

    return NextResponse.json({
      ok: true,
      id: submission.id,
      name: submission.name,
      email: submission.email,
      emailId: emailResult?.id || null,
      templateId: emailResult?.templateId || null,
      mode: emailResult?.mode || "sent",
    });
  } catch (emailErr) {
    const errorMessage = emailErr?.message || "Failed to send email";

    await supabase
      .from("lead_magnet_submissions")
      .update({
        email_status: "failed",
        email_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.id);

    return NextResponse.json(
      {
        error: errorMessage,
        saved: true,
        id: submission.id,
      },
      { status: 502 }
    );
  }
}
