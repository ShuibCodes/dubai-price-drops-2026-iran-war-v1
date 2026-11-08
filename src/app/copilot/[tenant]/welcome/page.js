import { Suspense } from "react";
import { WelcomeQuiz } from "@/components/console/welcome-quiz";

export const dynamic = "force-dynamic";

export default function WelcomeQuizPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return (
    <Suspense fallback={<div className="az-shell min-h-screen" />}>
      <WelcomeQuiz tenant={tenant} />
    </Suspense>
  );
}
