import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fingerprintResolvedAuth } from "./core.js";
import type { ResolvedUsageAuth } from "./types.js";

export function isCodexSlot(providerId: string | undefined): providerId is string {
  return typeof providerId === "string" && /^openai-codex-account-[1-9]\d*$/.test(providerId);
}

/** Numbered slots are distinct identities, never aliases for the base account. */
export async function resolveCodexSlotAuth(
  ctx: ExtensionContext,
  providerId: string,
  salt: Uint8Array,
  agentDir: string,
): Promise<ResolvedUsageAuth | undefined> {
  if (!isCodexSlot(providerId) || ctx.model?.provider !== providerId) return undefined;
  const model = ctx.model;
  if (model.api !== "openai-codex-responses") throw new Error("Codex slot has an unsupported API.");
  const runtime = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!runtime.ok) throw new Error("Codex slot runtime authentication is unavailable.");
  const baseUrl = runtime.baseUrl ?? model.baseUrl;
  const proxy = isSlotProxy(baseUrl, providerId);
  if (!proxy && !isOfficialCodexUrl(baseUrl)) throw new Error("Codex slot has an untrusted usage origin.");
  // A model override may differ from provider auth; do not silently replace it with disk auth.
  const authorization = Object.entries(runtime.headers ?? {}).find(([name]) => name.toLowerCase() === "authorization");
  const runtimeToken = authorization
    ? typeof authorization[1] === "string"
      ? authorization[1].match(/^Bearer\s+(\S+)$/i)?.[1]
      : undefined
    : runtime.apiKey;
  if (!runtimeToken) throw new Error("Codex slot runtime authentication is unavailable.");

  const stored = readSlot(agentDir, providerId);
  const claims = tokenClaims(stored.access);
  const accountId = record(claims?.["https://api.openai.com/auth"])?.chatgpt_account_id;
  if (
    stored.type !== "oauth" ||
    typeof stored.access !== "string" ||
    typeof accountId !== "string" ||
    !accountId ||
    stored.accountId !== accountId
  ) {
    throw new Error("Codex slot OAuth account identity is missing or inconsistent.");
  }
  if (
    typeof claims?.exp !== "number" ||
    claims.exp * 1000 <= Date.now() ||
    (typeof stored.expires === "number" && stored.expires <= Date.now())
  ) {
    throw new Error("Codex slot token expired. Refresh this account through pi-multi-account, then retry /usage.");
  }
  if (runtimeToken !== stored.access && !(proxy && runtimeToken === PROXY_PLACEHOLDER_JWT)) {
    throw new Error("Codex slot runtime and stored accounts do not match.");
  }
  const runtimeAccountId = Object.entries(runtime.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "chatgpt-account-id",
  )?.[1];
  if (
    runtimeAccountId &&
    runtimeAccountId !== accountId &&
    !(proxy && runtimeToken === PROXY_PLACEHOLDER_JWT && runtimeAccountId === "pi-multi-account-proxy")
  ) {
    throw new Error("Codex slot runtime workspace does not match its stored account.");
  }
  const headers = { Authorization: `Bearer ${stored.access}`, "ChatGPT-Account-Id": accountId };
  return {
    model,
    apiKey: stored.access,
    headers,
    fingerprint: fingerprintResolvedAuth({ headers, baseUrl: `${baseUrl}#${providerId}` }, salt),
    secrets: [stored.access, headers.Authorization, ...(typeof stored.refresh === "string" ? [stored.refresh] : [])],
    effectiveBaseUrl: baseUrl,
    source: "pi-multi-account slot",
  };
}

function readSlot(agentDir: string, providerId: string): Record<string, unknown> {
  // The proxy owner shadows numbered credentials in auth.json with a non-secret placeholder.
  // Read only the exact slot, and never refresh/write the owner's rotating tokens here.
  let sidecar: Record<string, unknown>;
  try {
    const parsed = record(JSON.parse(readFileSync(join(agentDir, "pi-multi-account-proxy-oauth.json"), "utf8")));
    if (!parsed) throw new Error("Invalid credential store");
    sidecar = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Codex slot credential store is unreadable.");
    sidecar = {};
  }
  if (Object.hasOwn(sidecar, providerId)) return record(sidecar[providerId]) ?? {};
  try {
    return record(record(JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8")))?.[providerId]) ?? {};
  } catch {
    throw new Error("Codex slot credential store is unavailable.");
  }
}

function tokenClaims(token: unknown): Record<string, unknown> | undefined {
  if (typeof token !== "string" || token.split(".").length !== 3) return undefined;
  try {
    return record(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isSlotProxy(value: string, providerId: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      Boolean(url.port) &&
      url.pathname === `/${providerId}` &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isOfficialCodexUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://chatgpt.com" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const PROXY_PLACEHOLDER_JWT = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64"),
  Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "pi-multi-account-proxy" } }),
  ).toString("base64"),
  "",
].join(".");
