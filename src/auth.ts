import { AppError } from "./errors";
import type { AuthContext, Env } from "./types";

const encoder = new TextEncoder();

export async function requireProxyAuth(request: Request, env: Env): Promise<AuthContext> {
  const presentedKey = extractBearerToken(request.headers.get("Authorization"));

  if (!presentedKey) {
    throw new AppError(401, "Unauthorized", "authentication_error", "unauthorized");
  }

  if (!env.UCX_PROXY_KEY) {
    throw new AppError(500, "Server is not configured", "internal_error", "missing_proxy_key");
  }

  const matches = await timingSafeEqual(presentedKey, env.UCX_PROXY_KEY);
  if (!matches) {
    throw new AppError(401, "Unauthorized", "authentication_error", "unauthorized");
  }

  return {
    apiKeyHash: await sha256Hex(presentedKey),
    apiKeyMask: maskKey(presentedKey),
  };
}

export function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function maskKey(value: string | undefined): string {
  if (!value) {
    return "(empty)";
  }

  if (value.length <= 8) {
    return "****";
  }

  const prefix = value.startsWith("sk-") ? "sk-" : value.slice(0, 2);
  return `${prefix}****${value.slice(-4)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await sha256Bytes(value);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let diff = left.length === right.length ? 0 : 1;

  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }

  return diff === 0;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(digest);
}
