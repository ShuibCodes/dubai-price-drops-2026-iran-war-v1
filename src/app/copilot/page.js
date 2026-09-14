import { Suspense } from "react";
import { CopilotLoginForm } from "@/components/console/copilot-login-form";
import { CopilotLoginPreview } from "@/components/console/copilot-login-preview";
import { isSupabaseAuthConfigured } from "@/lib/supabase/auth-server";

export const metadata = {
  title: "Log in | Operations Copilot",
  description: "Sign in to Operations Copilot to run campaigns, review calls, and chase leads.",
};

function LoginFormFallback() {
  return (
    <div className="w-full max-w-[400px] text-sm text-[#8A94A6]">Loading…</div>
  );
}

export default function CopilotPage() {
  return (
    <main className="grid min-h-dvh bg-white lg:h-dvh lg:grid-cols-2 lg:overflow-hidden">
      <section className="flex items-center justify-center overflow-y-auto bg-white px-6 py-12 text-[#0a0a0a] sm:px-12">
        <Suspense fallback={<LoginFormFallback />}>
          <CopilotLoginForm googleEnabled={isSupabaseAuthConfigured()} />
        </Suspense>
      </section>
      <CopilotLoginPreview />
    </main>
  );
}
