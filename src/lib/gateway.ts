import { WaveError } from "@wave-av/sdk";
import { resolveCredentials, type ResolvedCredentials } from "./auth/credentials.js";
import { AuthRequiredError } from "./errors.js";
import { CLI_VERSION, cliUserAgent } from "./version.js";

/**
 * Raw requests to gateway routes that have no SDK module yet (billing, analytics overview,
 * identity, webhook subscriptions, link's org discovery). Same credential and host resolution as
 * getClient(), so WAVE_API_KEY / WAVE_BASE_URL / --project behave identically everywhere.
 */

export interface GatewayRequestInit {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  project?: string;
  /** Pre-resolved credentials (skips a second keychain/config read). */
  credentials?: ResolvedCredentials;
}

/**
 * Turn any gateway error body into a WaveError. Most routes return the canonical
 * `{error:{code,message}}`, but some (spend-cap 402s, mesh 400s) return a flat
 * `{error:"...", code:"...", message:"..."}`; the SDK's parser reads only the nested shape and
 * reports those as a bare "HTTP_402 Payment Required", dropping the actionable message.
 */
export function toGatewayError(
  status: number,
  statusText: string,
  body: unknown,
  requestId?: string,
): WaveError {
  let code = `HTTP_${status}`;
  let message = statusText || `Request failed with status ${status}`;
  let details: Record<string, unknown> | undefined;
  let bodyRequestId: string | undefined;

  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b["error"];
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (typeof e["code"] === "string") code = e["code"];
      if (typeof e["message"] === "string") message = e["message"];
      if (typeof e["request_id"] === "string") bodyRequestId = e["request_id"];
      const { code: _c, message: _m, ...rest } = e;
      details = Object.keys(rest).length ? rest : undefined;
    } else {
      if (typeof b["code"] === "string") code = b["code"];
      else if (typeof err === "string") code = err;
      if (typeof b["message"] === "string") message = b["message"];
      else if (typeof err === "string") message = err;
      const { error: _e, code: _c, message: _m, ...rest } = b;
      details = Object.keys(rest).length ? rest : undefined;
    }
    if (!bodyRequestId && typeof b["request_id"] === "string") bodyRequestId = b["request_id"];
  }

  return new WaveError(message, code, status, requestId ?? bodyRequestId, details);
}

export async function gatewayFetch<T = unknown>(path: string, init: GatewayRequestInit = {}): Promise<T> {
  const creds = init.credentials ?? (await resolveCredentials({ project: init.project }));
  if (!creds) throw new AuthRequiredError();

  const url = new URL(`${creds.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${creds.apiKey}`,
    accept: "application/json",
    "user-agent": cliUserAgent(),
    "x-wave-source": "cli",
    "x-wave-cli-version": CLI_VERSION,
  };
  if (creds.organizationId) headers["x-organization-id"] = creds.organizationId;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
  }

  if (!res.ok) {
    throw toGatewayError(res.status, res.statusText, body, res.headers.get("x-request-id") ?? undefined);
  }
  return body as T;
}
