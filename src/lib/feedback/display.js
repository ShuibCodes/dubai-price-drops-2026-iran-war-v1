import {
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
} from "@/lib/feedback/constants";

export function typeLabel(type) {
  return FEEDBACK_TYPE_LABELS[type] || type;
}

export function statusLabel(status) {
  return FEEDBACK_STATUS_LABELS[status] || status;
}

export function statusTone(status) {
  if (status === "in_progress" || status === "resolved") return "live";
  if (status === "in_review") return "warn";
  if (status === "closed") return "draft";
  return "required";
}

export function formatWhen(value, tz = "Asia/Dubai") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleString("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
}
