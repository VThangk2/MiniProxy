import { AppError } from "./errors";
import type { AppConfig, ChatCompletionRequest, Env, OpenAIUsage } from "./types";

export async function callMiniMax(body: ChatCompletionRequest, env: Env, config: AppConfig, requestId: string): Promise<Response> {
  if (!env.MINIMAX_API_KEY) {
    throw new AppError(500, "Server is not configured", "internal_error", "missing_minimax_key");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("upstream_timeout"), config.upstreamTimeoutMs);

  try {
    return await fetch(`${config.minimaxBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new AppError(504, "Upstream timeout", "timeout_error", "upstream_timeout");
    }

    throw new AppError(502, "Upstream request failed", "upstream_error", "upstream_error");
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildUpstreamError(response: Response): Promise<AppError> {
  const message = await readUpstreamErrorMessage(response);
  return new AppError(502, message, "upstream_error", "upstream_error");
}

export function parseUsage(bodyText: string): OpenAIUsage | undefined {
  try {
    const parsed = JSON.parse(bodyText) as { usage?: OpenAIUsage };
    return parsed.usage && typeof parsed.usage === "object" ? parsed.usage : undefined;
  } catch {
    return undefined;
  }
}

async function readUpstreamErrorMessage(response: Response): Promise<string> {
  const fallback = `Upstream MiniMax error (${response.status})`;

  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }

    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message || parsed.message;
    return typeof message === "string" && message.length > 0 ? `Upstream MiniMax error (${response.status}): ${message}` : fallback;
  } catch {
    return fallback;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
