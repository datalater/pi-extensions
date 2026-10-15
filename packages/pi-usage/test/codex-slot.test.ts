import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterAll, test, vi } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";

const dir = mkdtempSync(join(tmpdir(), "pi-usage-slot-test-"));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => dir,
}));
const source = await import("../src/query.js");
const { resolveCodexSlotAuth } = await import("../src/codex-slot-auth.js");
const { formatUsageReport } = await import("../src/format.js");
const { default: usageExtension } = await import("../src/usage.js");
const slot = "openai-codex-account-3";
const salt = new Uint8Array([1, 2, 3]);
const token = (id: string, exp = Date.now() / 1000 + 3600) =>
  "eyJhbGciOiJSUzI1NiJ9." +
  Buffer.from(JSON.stringify({ exp, "https://api.openai.com/auth": { chatgpt_account_id: id } })).toString(
    "base64url",
  ) +
  ".fixture-signature";
const credential = (id: string) => ({ type: "oauth", access: token(id), accountId: id, expires: Date.now() + 3600000 });
const placeholder = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64"),
  Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "pi-multi-account-proxy" } }),
  ).toString("base64"),
  "",
].join(".");
const authFile = join(dir, "auth.json");
const sidecarFile = join(dir, "pi-multi-account-proxy-oauth.json");
const ctx = (key: string, baseUrl = `http://127.0.0.1:41977/${slot}`, headers?: Record<string, string | null>) =>
  ({
    model: { provider: slot, id: "test-model", api: "openai-codex-responses", baseUrl },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: key, headers }) },
  }) as unknown as ExtensionContext;
function store(entry = credential("account-3")) {
  writeFileSync(
    authFile,
    JSON.stringify({ "openai-codex": credential("account-1"), [slot]: { type: "api_key", key: placeholder } }),
  );
  writeFileSync(sidecarFile, JSON.stringify({ [slot]: entry }));
  return entry;
}
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("numbered slot queries its own account and renders credits at zero quota", async () => {
  store();
  for (const q of [source]) {
    const adapter = q.adapterForProvider(slot);
    assert.ok(adapter);
    assert.equal(adapter.id, slot);
    const auth = await q.resolveUsageAuth(ctx(placeholder), adapter, salt);
    assert.ok(auth);
    assert.equal(auth.headers?.["ChatGPT-Account-Id"], "account-3");
    const original = globalThis.fetch;
    let calls = 0;
    let guards = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
      assert.equal(new Headers(options?.headers).get("ChatGPT-Account-Id"), "account-3");
      assert.equal(options?.redirect, "error");
      return Response.json({
        account_id: "account-3",
        rate_limit: { primary_window: { used_percent: 100, reset_at: 1900000000, limit_window_seconds: 604800 } },
        credits: { has_credits: true, balance: "45.25" },
      });
    };
    try {
      const report = await q.queryProviderUsage(adapter, auth, new AbortController().signal, 1000, async () => {
        guards++;
      });
      assert.equal(report.accountLabel, slot);
      assert.equal(report.buckets[0].remaining, 0);
      assert.equal(report.metrics?.find((x) => x.id === "credits")?.value, 45.25);
      assert.match(formatUsageReport(report, "current"), /45\.25/);
      assert.equal(calls, 1);
      assert.equal(guards, 2);
    } finally {
      globalThis.fetch = original;
    }
  }
});
test("missing slot never falls back to base account or another slot", async () => {
  store();
  writeFileSync(sidecarFile, JSON.stringify({ "openai-codex-account-2": credential("account-2") }));
  await assert.rejects(resolveCodexSlotAuth(ctx(placeholder), slot, salt, dir), /identity/);
});
test("expired slot refuses rather than refreshing or writing credentials", async () => {
  const entry = store();
  entry.access = token("account-3", 1);
  store(entry);
  await assert.rejects(resolveCodexSlotAuth(ctx(placeholder), slot, salt, dir), /expired/);
});
test("same-slot account replacement invalidates cached fingerprint", async () => {
  store();
  const first = await resolveCodexSlotAuth(ctx(placeholder), slot, salt, dir);
  store(credential("replacement"));
  const second = await resolveCodexSlotAuth(ctx(placeholder), slot, salt, dir);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.fingerprint, second.fingerprint);
});
test("runtime override and workspace mismatch fail closed", async () => {
  store();
  await assert.rejects(resolveCodexSlotAuth(ctx(token("other")), slot, salt, dir), /do not match/);
  await assert.rejects(
    resolveCodexSlotAuth(ctx(placeholder, undefined, { "ChatGPT-Account-Id": "other" }), slot, salt, dir),
    /workspace/,
  );
  await assert.rejects(
    resolveCodexSlotAuth(ctx(placeholder, undefined, { Authorization: null }), slot, salt, dir),
    /unavailable/,
  );
});
test("proxy placeholder is accepted only for the exact local slot route", async () => {
  store();
  for (const url of [
    "https://example.com",
    "http://127.0.0.1:41977/openai-codex-account-2",
    "https://chatgpt.com/backend-api",
  ]) {
    await assert.rejects(resolveCodexSlotAuth(ctx(placeholder, url), slot, salt, dir));
  }
});
test("direct official runtime OAuth works only for the matching slot", async () => {
  const entry = store();
  const auth = await resolveCodexSlotAuth(ctx(entry.access, "https://chatgpt.com/backend-api"), slot, salt, dir);
  assert.ok(auth);
  assert.equal(auth.headers["ChatGPT-Account-Id"], "account-3");
});
test("wrong-account usage responses are rejected", async () => {
  store();
  const a = source.adapterForProvider(slot);
  assert.ok(a);
  const auth = await source.resolveUsageAuth(ctx(placeholder), a, salt);
  assert.ok(auth);
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ account_id: "account-1", credits: { has_credits: true, balance: "999" } });
  try {
    await assert.rejects(
      source.queryProviderUsage(a, auth, new AbortController().signal, 1000, async () => {}),
      /different account/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
for (const change of ["none", "token", "route", "continuous"] as const) {
  test(`startup status settles without a prompt when slot changes: ${change}`, async () => {
    store();
    const originalFetch = globalThis.fetch;
    const mock = createMockPi();
    usageExtension(mock.pi);
    const model = {
      provider: slot,
      id: "test-model",
      name: "Test model",
      api: "openai-codex-responses",
      baseUrl: `http://127.0.0.1:41977/${slot}`,
    };
    const current = createMockContext({
      model,
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: placeholder }) },
    });
    let requests = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://chatgpt.com/backend-api/wham/usage");
      requests++;
      const accountId = new Headers(options?.headers).get("chatgpt-account-id");
      if ((requests === 1 && change === "token") || change === "continuous")
        store(credential(`account-next-${requests}`));
      if (requests === 1 && change === "route") model.baseUrl = `http://127.0.0.1:41978/${slot}`;
      return Response.json({
        account_id: accountId,
        rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 604800 } },
        credits: { has_credits: true, balance: "39570" },
      });
    };
    try {
      await mock.events.get("session_start")?.[0]?.({}, current.ctx);
      await vi.waitFor(
        () => {
          const status = current.statuses.get("usage");
          assert.ok(status && status !== "checking", "startup must settle without turn_start or a user message");
          if (change === "continuous") assert.match(status, /usage err:/);
          else assert.match(status, /39\.57k/);
        },
        { timeout: 500 },
      );
      assert.equal(requests, change === "none" ? 1 : change === "continuous" ? 3 : 2);
    } finally {
      for (const handler of mock.events.get("session_shutdown") ?? []) await handler({}, current.ctx);
      globalThis.fetch = originalFetch;
    }
  });
}

test("shutdown during startup checking does not restart or publish the cancelled slot query", async () => {
  store();
  const originalFetch = globalThis.fetch;
  const mock = createMockPi();
  usageExtension(mock.pi);
  const current = createMockContext({
    model: {
      provider: slot,
      id: "test-model",
      name: "Test model",
      api: "openai-codex-responses",
      baseUrl: `http://127.0.0.1:41977/${slot}`,
    },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: placeholder }) },
  });
  let requests = 0;
  let release: (response: Response) => void = () => {};
  globalThis.fetch = () => {
    requests++;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  };
  try {
    await mock.events.get("session_start")?.[0]?.({}, current.ctx);
    await vi.waitFor(() => assert.equal(requests, 1), { timeout: 500 });
    for (const handler of mock.events.get("session_shutdown") ?? []) await handler({}, current.ctx);
    store(credential("changed-after-shutdown"));
    release(Response.json({ account_id: "account-3", credits: { has_credits: true, balance: "39570" } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    assert.equal(current.statuses.get("usage"), undefined);
  } finally {
    for (const handler of mock.events.get("session_shutdown") ?? []) await handler({}, current.ctx);
    globalThis.fetch = originalFetch;
  }
});

test("query stops if account revalidation fails before request", async () => {
  store();
  const a = source.adapterForProvider(slot);
  assert.ok(a);
  const auth = await source.resolveUsageAuth(ctx(placeholder), a, salt);
  assert.ok(auth);
  const original = globalThis.fetch;
  let sent = false;
  globalThis.fetch = async () => {
    sent = true;
    return Response.json({});
  };
  try {
    await assert.rejects(
      source.queryProviderUsage(a, auth, new AbortController().signal, 1000, async () => {
        throw new Error("account changed");
      }),
      /account changed/,
    );
    assert.equal(sent, false);
  } finally {
    globalThis.fetch = original;
  }
});
