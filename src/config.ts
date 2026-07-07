import type { AppConfig, Env, LogLevel } from "./types";

const DEFAULTS = {
  MINIMAX_BASE_URL: "https://api.minimax.io/v1",
  RATE_LIMIT_PER_MINUTE: 30,
  DAILY_REQUEST_LIMIT: 500,
  MAX_INPUT_CHARS: 10000,
  MAX_TOKENS_LIMIT: 2048,
  ALLOWED_MODELS: "MiniMax-M2.7",
  UPSTREAM_TIMEOUT_MS: 60000,
  LOG_LEVEL: "info" as LogLevel,
  LOG_REQUEST_BODY: false,
  CORS_ORIGIN: "*",
};

export function getConfig(env: Env): AppConfig {
  return {
    minimaxBaseUrl: cleanBaseUrl(env.MINIMAX_BASE_URL || DEFAULTS.MINIMAX_BASE_URL),
    rateLimitPerMinute: readPositiveInt(env.RATE_LIMIT_PER_MINUTE, DEFAULTS.RATE_LIMIT_PER_MINUTE),
    dailyRequestLimit: readPositiveInt(env.DAILY_REQUEST_LIMIT, DEFAULTS.DAILY_REQUEST_LIMIT),
    maxInputChars: readPositiveInt(env.MAX_INPUT_CHARS, DEFAULTS.MAX_INPUT_CHARS),
    maxTokensLimit: readPositiveInt(env.MAX_TOKENS_LIMIT, DEFAULTS.MAX_TOKENS_LIMIT),
    allowedModels: readCsv(env.ALLOWED_MODELS || DEFAULTS.ALLOWED_MODELS),
    upstreamTimeoutMs: readPositiveInt(env.UPSTREAM_TIMEOUT_MS, DEFAULTS.UPSTREAM_TIMEOUT_MS),
    logLevel: readLogLevel(env.LOG_LEVEL),
    logRequestBody: readBoolean(env.LOG_REQUEST_BODY, DEFAULTS.LOG_REQUEST_BODY),
    corsOrigin: (env.CORS_ORIGIN || DEFAULTS.CORS_ORIGIN).trim() || DEFAULTS.CORS_ORIGIN,
    ucxAllowedIps: readCsv(env.UCX_ALLOWED_IPS || ""),
  };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readLogLevel(value: string | undefined): LogLevel {
  const normalized = (value || DEFAULTS.LOG_LEVEL).trim().toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return DEFAULTS.LOG_LEVEL;
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
