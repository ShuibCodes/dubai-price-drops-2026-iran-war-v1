import { NextResponse } from "next/server";
import { saveCompanyAccessRecord } from "@/lib/company-access-store";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const companyName = body?.companyName;
    const email = body?.email;

    const record = await saveCompanyAccessRecord({
      companyName,
      email,
    });

    return NextResponse.json({
      success: true,
      record,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message ?? "Could not save submission.",
      },
      { status: 400 }
    );
  }
}
