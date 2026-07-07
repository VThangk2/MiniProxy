export interface Env {
  MINIMAX_API_KEY?: string;
  UCX_PROXY_KEY?: string;
  RATE_LIMITER: DurableObjectNamespace;
  UPSTREAM_WORKER?: Fetcher;
  MINIMAX_BASE_URL?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  DAILY_REQUEST_LIMIT?: string;
  MAX_INPUT_CHARS?: string;
  MAX_TOKENS_LIMIT?: string;
  ALLOWED_MODELS?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  LOG_LEVEL?: string;
  LOG_REQUEST_BODY?: string;
  CORS_ORIGIN?: string;
  UCX_ALLOWED_IPS?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  minimaxBaseUrl: string;
  rateLimitPerMinute: number;
  dailyRequestLimit: number;
  maxInputChars: number;
  maxTokensLimit: number;
  allowedModels: string[];
  upstreamTimeoutMs: number;
  logLevel: LogLevel;
  logRequestBody: boolean;
  corsOrigin: string;
  ucxAllowedIps: string[];
}

export interface AuthContext {
  apiKeyHash: string;
  apiKeyMask: string;
}

export interface ChatCompletionRequest {
  model?: unknown;
  messages?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
  [key: string]: unknown;
}

export interface OpenAIMessage {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface RequestLogFields {
  requestId: string;
  time: string;
  method: string;
  path: string;
  clientIp?: string;
  model?: string;
  stream?: boolean;
  status?: number;
  latencyMs?: number;
  upstreamStatus?: number;
  errorCode?: string;
  usage?: OpenAIUsage;
}

export interface RateLimitCheckRequest {
  apiKeyHash: string;
  minuteLimit: number;
  dayLimit: number;
  nowEpochMs: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  minuteCount: number;
  dayCount: number;
  minuteLimit: number;
  dayLimit: number;
  resetMinuteEpochMs: number;
  resetDayEpochMs: number;
  retryAfterSeconds?: number;
}
