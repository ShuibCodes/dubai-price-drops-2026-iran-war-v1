import { z } from "zod";

export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
export const DEFAULT_APPOINTMENT_BUFFER_MINUTES = 15;
export const DEFAULT_CALENDAR_TIMEZONE = "Asia/Dubai";

/** Viewing window — not outbound dial hours. Sun–Thu 10:00–18:00 in the agent tz. */
export const VIEWING_WINDOW = {
  startHour: 10,
  endHour: 18,
  days: [0, 1, 2, 3, 4],
};

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Must be a uuid"
  );

const isoOffsetSchema = z.string().refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && /([zZ]|[+-]\d{2}:?\d{2})$/.test(String(value));
}, "Must be an ISO-8601 timestamp with offset");

const forbiddenSecretKeys = new Set([
  "access_token",
  "refresh_token",
  "token_ciphertext",
  "token",
  "ciphertext",
  "accessToken",
  "refreshToken",
]);

/** The model must never supply routing or Google identifiers as tool arguments. */
export const FORBIDDEN_CALENDAR_TOOL_KEYS = [
  "tenantId",
  "agentId",
  "calendarConnectionId",
  "calendarId",
  "access_token",
  "refresh_token",
  "accessToken",
  "refreshToken",
  "token",
  "token_ciphertext",
  "ciphertext",
];

function rejectSecrets(ctx, value) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (forbiddenSecretKeys.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: "Google tokens must not appear on Vapi or public payloads",
        path: [key],
      });
    }
  }
}

/** Speech-only. Visible to the Vapi model. Never used to call Google. */
export const calendarSpeechVariablesSchema = z
  .strictObject({
    calendarConnected: z.enum(["true", "false"]),
    calendarLabel: z.string(),
    calendarTimezone: z.string().min(1),
    appointmentDurationMinutes: z.string().regex(/^\d+$/),
  })
  .superRefine(rejectSecrets);

/**
 * Routing-only. Goes on call metadata. The model must never supply these
 * as tool arguments, and they must never include tokens or a Google calendarId.
 */
export const calendarCallMetadataSchema = z
  .strictObject({
    tenantId: uuidSchema,
    agentId: uuidSchema,
    calendarConnectionId: uuidSchema.nullable(),
  })
  .superRefine(rejectSecrets);

export const calendarTokenPayloadSchema = z.strictObject({
  refresh_token: z.string().trim().min(1),
  access_token: z.string().trim().min(1).nullable().optional(),
  expires_at: z.string().nullable().optional(),
  token_type: z.string().optional(),
  scope: z.string().nullable().optional(),
});

export const appointmentInputSchema = z
  .strictObject({
    tenantId: uuidSchema,
    agentId: uuidSchema,
    calendarConnectionId: uuidSchema.nullable().optional(),
    leadId: uuidSchema.nullable().optional(),
    jarvisLeadId: uuidSchema.nullable().optional(),
    callId: uuidSchema.nullable().optional(),
    vapiCallId: z.string().trim().min(1).nullable().optional(),
    summary: z.string().trim().min(1).max(200),
    startAt: isoOffsetSchema,
    endAt: isoOffsetSchema,
    timezone: z.string().trim().min(1),
  })
  .superRefine((value, ctx) => {
    rejectSecrets(ctx, value);
    if (new Date(value.endAt).getTime() <= new Date(value.startAt).getTime()) {
      ctx.addIssue({
        code: "custom",
        message: "endAt must be after startAt",
        path: ["endAt"],
      });
    }
  });

export const availabilityWindowSchema = z
  .strictObject({
    startDateTime: isoOffsetSchema,
    endDateTime: isoOffsetSchema,
    timeZone: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      new Date(value.endDateTime).getTime() <=
      new Date(value.startDateTime).getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        message: "endDateTime must be after startDateTime",
        path: ["endDateTime"],
      });
    }
  });

function parse(schema, input, label) {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "_root";
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return { ok: false, error: `Invalid ${label}`, fieldErrors };
}

export function parseCalendarSpeechVariables(input) {
  return parse(calendarSpeechVariablesSchema, input, "calendar speech variables");
}

export function parseCalendarCallMetadata(input) {
  return parse(calendarCallMetadataSchema, input, "calendar call metadata");
}

export function parseAppointmentInput(input) {
  return parse(appointmentInputSchema, input, "appointment");
}

export function parseAvailabilityWindow(input) {
  return parse(availabilityWindowSchema, input, "availability window");
}

export function parseCalendarTokenPayload(input) {
  return parse(calendarTokenPayloadSchema, input, "calendar token payload");
}

/**
 * Booking fields the model may send. Routing ids and tokens are rejected.
 * endDateTime or durationMinutes may be omitted; the handler applies the default duration.
 */
export const calendarToolBookingArgsSchema = z
  .strictObject({
    startDateTime: isoOffsetSchema,
    endDateTime: isoOffsetSchema.optional(),
    timeZone: z.string().trim().min(1).optional(),
    durationMinutes: z.coerce.number().int().positive().max(24 * 60).optional(),
    summary: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    rejectSecrets(ctx, value);
    if (
      value.endDateTime &&
      new Date(value.endDateTime).getTime() <= new Date(value.startDateTime).getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        message: "endDateTime must be after startDateTime",
        path: ["endDateTime"],
      });
    }
  });

/**
 * Trusted Vapi call.metadata fields used for Google routing.
 * Extra keys (leadId, source, …) are allowed; tokens are not.
 * calendarConnectionId is required before any calendar operation.
 */
export const trustedCalendarToolContextSchema = z
  .object({
    tenantId: uuidSchema,
    agentId: uuidSchema,
    calendarConnectionId: uuidSchema,
    leadId: uuidSchema.optional().nullable(),
    jarvisLeadId: uuidSchema.optional().nullable(),
  })
  .passthrough()
  .superRefine(rejectSecrets);

export function parseCalendarToolBookingArgs(input) {
  return parse(calendarToolBookingArgsSchema, input, "calendar tool arguments");
}

export function parseTrustedCalendarToolContext(input) {
  return parse(trustedCalendarToolContextSchema, input, "calendar tool metadata");
}

export function calendarToolArgsContainForbiddenKeys(input) {
  if (!input || typeof input !== "object") return [];
  return Object.keys(input).filter((key) => FORBIDDEN_CALENDAR_TOOL_KEYS.includes(key));
}
