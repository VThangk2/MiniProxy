export interface OpenAIError {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly headers: HeadersInit | undefined;

  constructor(status: number, message: string, type: string, code: string, headers?: HeadersInit) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.headers = headers;
  }
}

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

export function openAIError(message: string, type: string, code: string): OpenAIError {
  return {
    error: {
      message,
      type,
      code,
    },
  };
}

export function errorResponse(error: unknown): Response {
  const appError = normalizeError(error);
  return jsonResponse(openAIError(appError.message, appError.type, appError.code), appError.status, appError.headers);
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(500, "Internal server error", "internal_error", "internal_error");
}

export function methodNotAllowed(allowedMethods: string[]): AppError {
  return new AppError(405, "Method not allowed", "method_not_allowed", "method_not_allowed", {
    Allow: allowedMethods.join(", "),
  });
}
