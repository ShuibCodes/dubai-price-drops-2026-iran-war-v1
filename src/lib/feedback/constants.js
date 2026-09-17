export const FEEDBACK_TYPES = ["bug", "feature", "improvement", "other"];
export const FEEDBACK_STATUSES = [
  "new",
  "in_review",
  "in_progress",
  "resolved",
  "closed",
];
export const FEEDBACK_PRIORITIES = ["low", "normal", "high"];
export const FEEDBACK_AUTHOR_KINDS = ["client", "staff"];

export const FEEDBACK_TYPE_LABELS = {
  bug: "Bug",
  feature: "Feature Request",
  improvement: "Improvement",
  other: "Other",
};

export const FEEDBACK_STATUS_LABELS = {
  new: "New",
  in_review: "In Review",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const ATTACHMENT_BUCKET = "feedback-attachments";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isFeedbackType(value) {
  return FEEDBACK_TYPES.includes(String(value || ""));
}

export function isFeedbackStatus(value) {
  return FEEDBACK_STATUSES.includes(String(value || ""));
}

export function isFeedbackPriority(value) {
  return FEEDBACK_PRIORITIES.includes(String(value || ""));
}
