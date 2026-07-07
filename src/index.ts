import { requireProxyAuth } from "./auth";
import { getConfig } from "./config";
import { AppError, errorResponse, jsonResponse, methodNotAllowed } from "./errors";
import { enforceRateLimit, RateLimiter } from "./limiter";
import { Logger, createRequestId, debugRequestBody, logRequestSummary, maskIp } from "./logging";
import { buildUpstreamError, callMiniMax, parseUsage } from "./minimax";
import type { AppConfig, ChatCompletionRequest, Env, OpenAIMessage, RequestLogFields } from "./types";

export { RateLimiter };

const CHAT_PATHS = new Set(["/v1/chat/completions", "/chat/completions"]);
const MODEL_PATHS = new Set(["/v1/models", "/models"]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (env.UPSTREAM_WORKER) {
      return env.UPSTREAM_WORKER.fetch(request);
    }

    const startedAt = Date.now();
    const requestId = createRequestId();
    const url = new URL(request.url);
    const config = getConfig(env);
    const logger = new Logger(config, requestId);
    const requestLog: RequestLogFields = {
      requestId,
      time: new Date(startedAt).toISOString(),
      method: request.method,
      path: url.pathname,
      clientIp: maskIp(getClientIp(request)),
    };

    let response: Response;

    try {
      response = await route(request, env, ctx, config, logger, requestLog);
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError(500, "Internal server error", "internal_error", "internal_error");
      requestLog.errorCode = appError.code;
      response = errorResponse(appError);
    }

    requestLog.status = response.status;
    requestLog.latencyMs = Date.now() - startedAt;
    logRequestSummary(config, requestLog);

    return withStandardHeaders(response, config, requestId);
  },
} satisfies ExportedHandler<Env>;

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  config: AppConfig,
  logger: Logger,
  requestLog: RequestLogFields,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (path === "/health") {
    if (request.method !== "GET") {
      throw methodNotAllowed(["GET", "OPTIONS"]);
    }

    return jsonResponse({
      status: "ok",
      service: "ucx-minimax-proxy",
      time: new Date().toISOString(),
    });
  }

  if (MODEL_PATHS.has(path)) {
    if (request.method !== "GET") {
      throw methodNotAllowed(["GET", "OPTIONS"]);
    }

    await requireProxyAuth(request, env);
    enforceIpAllowlist(request, config);
    return jsonResponse({
      object: "list",
      data: config.allowedModels.map((model) => ({
        id: model,
        object: "model",
        created: 0,
        owned_by: "minimax",
      })),
    });
  }

  if (CHAT_PATHS.has(path)) {
    if (request.method !== "POST") {
      throw methodNotAllowed(["POST", "OPTIONS"]);
    }

    const auth = await requireProxyAuth(request, env);
    enforceIpAllowlist(request, config);
    await enforceRateLimit(env, config, auth);

    const body = await readJsonBody(request);
    const validatedBody = validateChatCompletionRequest(body, config);
    requestLog.model = validatedBody.model as string;
    requestLog.stream = validatedBody.stream as boolean;
    debugRequestBody(logger, config, validatedBody);

    const upstreamResponse = await callMiniMax(validatedBody, env, config, requestLog.requestId);
    requestLog.upstreamStatus = upstreamResponse.status;

    if (!upstreamResponse.ok) {
      throw await buildUpstreamError(upstreamResponse);
    }

    if (validatedBody.stream === true) {
      return streamResponse(upstreamResponse);
    }

    const responseText = await upstreamResponse.text();
    requestLog.usage = parseUsage(responseText);
    return new Response(responseText, {
      status: upstreamResponse.status,
      headers: copyUpstreamHeaders(upstreamResponse.headers, "application/json; charset=utf-8"),
    });
  }

  throw new AppError(404, "Not found", "invalid_request_error", "not_found");
}

function validateChatCompletionRequest(body: ChatCompletionRequest, config: AppConfig): ChatCompletionRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Request body must be a JSON object", "invalid_request_error", "invalid_request");
  }

  if (typeof body.model !== "string" || body.model.trim().length === 0) {
    throw new AppError(400, "model is required", "invalid_request_error", "invalid_request");
  }

  if (!config.allowedModels.includes(body.model)) {
    throw new AppError(403, "Forbidden model", "forbidden_error", "forbidden_model");
  }

  if (!Array.isArray(body.messages)) {
    throw new AppError(400, "messages must be an array", "invalid_request_error", "invalid_request");
  }

  validateMessages(body.messages);
  const inputChars = countMessageContentChars(body.messages);
  if (inputChars > config.maxInputChars) {
    throw new AppError(413, "Input is too large", "invalid_request_error", "input_too_large");
  }

  if (body.temperature !== undefined && !isValidTemperature(body.temperature)) {
    throw new AppError(400, "temperature must be a number between 0 and 2", "invalid_request_error", "invalid_request");
  }

  if (body.max_tokens !== undefined) {
    if (!Number.isInteger(body.max_tokens) || (body.max_tokens as number) <= 0) {
      throw new AppError(400, "max_tokens must be a positive integer", "invalid_request_error", "invalid_request");
    }

    if ((body.max_tokens as number) > config.maxTokensLimit) {
      body.max_tokens = config.maxTokensLimit;
    }
  }

  if (body.stream === undefined) {
    body.stream = false;
  }

  if (typeof body.stream !== "boolean") {
    throw new AppError(400, "stream must be a boolean", "invalid_request_error", "invalid_request");
  }

  return body;
}

async function readJsonBody(request: Request): Promise<ChatCompletionRequest> {
  try {
    return (await request.json()) as ChatCompletionRequest;
  } catch {
    throw new AppError(400, "Invalid JSON body", "invalid_request_error", "invalid_json");
  }
}

function validateMessages(messages: unknown[]): void {
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new AppError(400, "Each message must be an object", "invalid_request_error", "invalid_request");
    }

    const typedMessage = message as OpenAIMessage;
    if (typeof typedMessage.role !== "string" || typedMessage.role.length === 0) {
      throw new AppError(400, "Each message must include a role", "invalid_request_error", "invalid_request");
    }
  }
}

function countMessageContentChars(messages: unknown[]): number {
  return messages.reduce<number>((sum, message) => {
    const typedMessage = message as OpenAIMessage;
    return sum + countContentChars(typedMessage.content);
  }, 0);
}

function countContentChars(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countContentChars(item), 0);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + countContentChars(item), 0);
  }

  return 0;
}

function isValidTemperature(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2;
}

function enforceIpAllowlist(request: Request, config: AppConfig): void {
  if (config.ucxAllowedIps.length === 0) {
    return;
  }

  const clientIp = getClientIp(request);
  if (!clientIp || !config.ucxAllowedIps.includes(clientIp)) {
    throw new AppError(403, "Forbidden IP", "forbidden_error", "forbidden_ip");
  }
}

function getClientIp(request: Request): string | undefined {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
}

function streamResponse(upstreamResponse: Response): Response {
  const headers = copyUpstreamHeaders(upstreamResponse.headers, "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}

function copyUpstreamHeaders(upstreamHeaders: Headers, fallbackContentType: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", upstreamHeaders.get("Content-Type") || fallbackContentType);

  const requestId = upstreamHeaders.get("X-Request-Id");
  if (requestId) {
    headers.set("X-Upstream-Request-Id", requestId);
  }

  return headers;
}

function withStandardHeaders(response: Response, config: AppConfig, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  headers.set("Access-Control-Allow-Origin", config.corsOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (config.corsOrigin !== "*") {
    headers.append("Vary", "Origin");
  }

  if (response.status === 204) {
    return new Response(null, {
      status: response.status,
      headers,
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
