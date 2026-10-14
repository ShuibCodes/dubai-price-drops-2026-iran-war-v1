import { createOAuthHandler } from "@/lib/copilot/oauth-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createOAuthHandler("facebook");
