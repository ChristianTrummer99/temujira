import { z } from "zod";

export const ERROR_CODES = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "rate_limited",
  "server_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  server_error: 500,
};
