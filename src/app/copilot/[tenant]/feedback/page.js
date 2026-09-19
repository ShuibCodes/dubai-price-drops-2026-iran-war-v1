import { FeedbackList } from "@/components/console/feedback-list";

export const dynamic = "force-dynamic";

export default function CopilotFeedbackPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  return <FeedbackList tenant={tenant} />;
}
