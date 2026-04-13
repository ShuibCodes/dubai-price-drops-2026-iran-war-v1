import { NextResponse } from "next/server";
import { sendLeadEmail } from "@/lib/email/resend-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = typeof body?.to === "string" ? body.to.trim() : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

  if (!to || !subject || !text) {
    return NextResponse.json({ error: "to, subject and text are required" }, { status: 400 });
  }

  try {
    const result = await sendLeadEmail({ to, subject, text, metadata });
    return NextResponse.json({
      success: true,
      id: result?.id ?? null,
      to,
      subject,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to send email" },
      { status: 502 }
    );
  }
}
