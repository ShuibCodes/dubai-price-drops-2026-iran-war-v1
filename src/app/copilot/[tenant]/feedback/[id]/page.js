import { FeedbackDetail } from "@/components/console/feedback-detail";

export const dynamic = "force-dynamic";

export default function CopilotFeedbackTicketPage({ params }) {
  const tenant = String(params?.tenant || "").trim();
  const id = String(params?.id || "").trim();
  return <FeedbackDetail tenant={tenant} ticketId={id} />;
}
