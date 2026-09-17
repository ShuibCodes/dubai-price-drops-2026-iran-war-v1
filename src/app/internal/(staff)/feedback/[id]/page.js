import { InternalFeedbackDetail } from "@/components/internal/feedback-detail";

export const dynamic = "force-dynamic";

export default function InternalFeedbackTicketPage({ params }) {
  const id = String(params?.id || "").trim();
  return <InternalFeedbackDetail ticketId={id} />;
}
