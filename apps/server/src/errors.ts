import { HTTP_STATUS_BY_CODE, type ErrorCode } from "@temujira/shared";

export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  get status(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }
}

export const unauthorized = (message = "authentication required") => new HttpError("unauthorized", message);
export const forbidden = (message = "not allowed") => new HttpError("forbidden", message);
export const notFound = (what = "resource") => new HttpError("not_found", `${what} not found`);
export const conflict = (message: string) => new HttpError("conflict", message);
export const validationError = (message: string, details?: unknown) =>
  new HttpError("validation_error", message, details);
