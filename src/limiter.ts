import { DurableObject } from "cloudflare:workers";
import { AppError, jsonResponse, methodNotAllowed } from "./errors";
import type { AppConfig, AuthContext, Env, RateLimitCheckRequest, RateLimitCheckResult } from "./types";

interface CounterRow extends Record<string, SqlStorageValue> {
  count: number;
}

export class RateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_counters_expires_at ON counters (expires_at);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      throw methodNotAllowed(["POST"]);
    }

    const payload = (await request.json()) as RateLimitCheckRequest;
    const result = this.check(payload);
    return jsonResponse(result);
  }

  private check(payload: RateLimitCheckRequest): RateLimitCheckResult {
    const now = new Date(payload.nowEpochMs);
    const windows = getWindows(now);
    const minuteKey = `m:${payload.apiKeyHash}:${windows.day}:${windows.minute}`;
    const dayKey = `d:${payload.apiKeyHash}:${windows.day}`;

    this.deleteExpired(payload.nowEpochMs);

    const minuteCount = this.incrementAndGet(minuteKey, windows.resetMinuteEpochMs + 120000);
    const dayCount = this.incrementAndGet(dayKey, windows.resetDayEpochMs + 3600000);
    const minuteExceeded = minuteCount > payload.minuteLimit;
    const dayExceeded = dayCount > payload.dayLimit;
    const retryAfterSeconds = dayExceeded
      ? Math.max(1, Math.ceil((windows.resetDayEpochMs - payload.nowEpochMs) / 1000))
      : Math.max(1, Math.ceil((windows.resetMinuteEpochMs - payload.nowEpochMs) / 1000));

    return {
      allowed: !minuteExceeded && !dayExceeded,
      minuteCount,
      dayCount,
      minuteLimit: payload.minuteLimit,
      dayLimit: payload.dayLimit,
      resetMinuteEpochMs: windows.resetMinuteEpochMs,
      resetDayEpochMs: windows.resetDayEpochMs,
      retryAfterSeconds: minuteExceeded || dayExceeded ? retryAfterSeconds : undefined,
    };
  }

  private incrementAndGet(key: string, expiresAt: number): number {
    this.ctx.storage.sql.exec(
      `
      INSERT INTO counters (key, count, expires_at)
      VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = count + 1,
        expires_at = excluded.expires_at;
      `,
      key,
      expiresAt,
    );

    const row = this.ctx.storage.sql.exec<CounterRow>("SELECT count FROM counters WHERE key = ?", key).one();
    return Number(row.count);
  }

  private deleteExpired(nowEpochMs: number): void {
    this.ctx.storage.sql.exec("DELETE FROM counters WHERE expires_at < ?", nowEpochMs);
  }
}

export async function enforceRateLimit(env: Env, config: AppConfig, auth: AuthContext): Promise<RateLimitCheckResult> {
  const objectId = env.RATE_LIMITER.idFromName(auth.apiKeyHash);
  const stub = env.RATE_LIMITER.get(objectId);
  const response = await stub.fetch("https://rate-limiter/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKeyHash: auth.apiKeyHash,
      minuteLimit: config.rateLimitPerMinute,
      dayLimit: config.dailyRequestLimit,
      nowEpochMs: Date.now(),
    } satisfies RateLimitCheckRequest),
  });

  if (!response.ok) {
    throw new AppError(500, "Rate limiter unavailable", "internal_error", "rate_limiter_unavailable");
  }

  const result = (await response.json()) as RateLimitCheckResult;
  if (!result.allowed) {
    throw new AppError(429, "Rate limit exceeded", "rate_limit_error", "rate_limit_exceeded", {
      "Retry-After": String(result.retryAfterSeconds || 60),
    });
  }

  return result;
}

function getWindows(now: Date): { day: string; minute: string; resetMinuteEpochMs: number; resetDayEpochMs: number } {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const month = pad(monthIndex + 1);
  const date = pad(now.getUTCDate());
  const hour = pad(now.getUTCHours());
  const minute = pad(now.getUTCMinutes());

  return {
    day: `${year}${month}${date}`,
    minute: `${year}${month}${date}${hour}${minute}`,
    resetMinuteEpochMs: Date.UTC(year, monthIndex, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes() + 1, 0, 0),
    resetDayEpochMs: Date.UTC(year, monthIndex, now.getUTCDate() + 1, 0, 0, 0, 0),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
