import { Suspense } from "react";
import { isSupabaseAuthConfigured } from "@/lib/supabase/auth-server";
import LoginForm from "./login-form";

export default function CopilotLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="az-shell grid min-h-screen place-items-center font-sans text-dim">
          Loading…
        </div>
      }
    >
      <LoginForm googleEnabled={isSupabaseAuthConfigured()} />
    </Suspense>
  );
}
