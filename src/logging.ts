import type { AppConfig, ChatCompletionRequest, LogLevel, RequestLogFields } from "./types";

const LOG_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  constructor(private readonly config: AppConfig, private readonly requestId: string) {}

  debug(event: string, fields: Record<string, unknown> = {}): void {
    this.write("debug", event, fields);
  }

  info(event: string, fields: Record<string, unknown> = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: Record<string, unknown> = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: Record<string, unknown> = {}): void {
    this.write("error", event, fields);
  }

  private write(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    if (LOG_RANK[level] < LOG_RANK[this.config.logLevel]) {
      return;
    }

    const entry = {
      level,
      event,
      requestId: this.requestId,
      time: new Date().toISOString(),
      ...fields,
    };

    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }
}

export function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function maskIp(ip: string | undefined): string | undefined {
  if (!ip) {
    return undefined;
  }

  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return `${parts.slice(0, 3).join(":")}:****`;
  }

  return "masked";
}

export function logRequestSummary(config: AppConfig, fields: RequestLogFields): void {
  const logger = new Logger(config, fields.requestId);
  const level: LogLevel = fields.status && fields.status >= 500 ? "error" : fields.status && fields.status >= 400 ? "warn" : "info";
  logger[level]("request_complete", fields as unknown as Record<string, unknown>);
}

export function debugRequestBody(logger: Logger, config: AppConfig, body: ChatCompletionRequest): void {
  if (!config.logRequestBody) {
    return;
  }

  logger.debug("request_body_preview", {
    bodyPreview: {
      model: typeof body.model === "string" ? body.model : undefined,
      stream: typeof body.stream === "boolean" ? body.stream : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
      messageCount: Array.isArray(body.messages) ? body.messages.length : undefined,
      inputChars: Array.isArray(body.messages) ? estimateMessagesLength(body.messages) : undefined,
      hasTools: Array.isArray(body.tools),
    },
  });
}

function estimateMessagesLength(messages: unknown[]): number {
  return messages.reduce<number>((sum, message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return sum;
    }

    return sum + estimateContentLength((message as { content?: unknown }).content);
  }, 0);
}

function estimateContentLength(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + estimateContentLength(item), 0);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + estimateContentLength(item), 0);
  }

  return 0;
}
