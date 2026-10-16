import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterAll, type TestContext, test, vi } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";

const directory = mkdtempSync(join(tmpdir(), "pi-slot-fast-"));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getAgentDir: () => directory,
}));
const { registerCodexFastMode } = await import("../src/codex-fast-runtime.js");
const { verifiedCodexSlotRoute } = await import("../src/codex-slot-auth.js");
const { createUsageSettingsRuntime } = await import("../src/settings.js");
const slot = "openai-codex-account-3";
const model = {
  provider: slot,
  id: "future-model",
  name: "Future model",
  api: "openai-codex-responses",
  baseUrl: `http://127.0.0.1:57446/${slot}`,
};
const placeholder = [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64"),
  Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "pi-multi-account-proxy" } }),
  ).toString("base64"),
  "",
].join(".");
const publication = { providers: { [slot]: { baseUrl: `http://127.0.0.1:41977/${slot}`, apiKey: placeholder } } };
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function fixture(t: TestContext, enabled = true, legacy?: boolean) {
  writeFileSync(join(directory, "models.json"), JSON.stringify(publication));
  const settingsPath = join(directory, "pi-usage.json");
  const originalSettings = JSON.stringify({ codexFastMode: enabled, unrelated: "preserve" });
  writeFileSync(settingsPath, originalSettings);
  const settings = createUsageSettingsRuntime({ path: settingsPath });
  const mock = createMockPi();
  let branch: Array<{ type: string; customType: string; data: { enabled: boolean } }> =
    legacy === undefined ? [] : [{ type: "custom", customType: "codex-fast", data: { enabled: legacy } }];
  const created = createMockContext({
    hasUI: true,
    mode: "rpc",
    model: { ...model },
    sessionManager: {
      getSessionId: () => "fixture-session",
      getBranch: () => [...branch, ...mock.entries.map((entry) => ({ type: "custom", ...entry }))],
    },
  });
  const current = { ...created, ctx: created.ctx as ExtensionCommandContext };
  let refreshes = 0;
  const fast = registerCodexFastMode(mock.pi, settings, () => {
    refreshes++;
  });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("No network calls allowed in slot Fast controls");
  });
  const fire = async (name: string, payload: unknown = {}) => {
    let result: unknown;
    for (const handler of mock.events.get(name) ?? []) {
      const value = await handler(payload, current.ctx);
      if (value !== undefined) result = value;
    }
    return result;
  };
  const command = async (name: string, args = "") => {
    const registered = mock.commands.get(name);
    assert.ok(registered);
    return registered.handler(args, current.ctx);
  };
  t.onTestFinished(async () => {
    await fire("session_shutdown");
    assert.equal(
      readFileSync(settingsPath, "utf8"),
      originalSettings,
      "slot controls must not rewrite base Fast settings",
    );
    assert.equal(fetchSpy.mock.calls.length, 0);
    fetchSpy.mockRestore();
  });
  await fire("session_start");
  return {
    mock,
    current,
    fast,
    command,
    fire,
    refreshes: () => refreshes,
    replaceBranch: () => {
      branch = [];
      mock.entries.length = 0;
    },
  };
}

test("numbered proxy validation allows a different runtime port but not a foreign route or API key", () => {
  const current = (createMockContext({ model }).ctx as ExtensionContext).model;
  assert.ok(current);
  assert.equal(verifiedCodexSlotRoute(current, publication), model.baseUrl);
  for (const patch of [
    { provider: "openai-codex" },
    { api: "openai-responses" },
    { baseUrl: "https://chatgpt.com/backend-api" },
    { baseUrl: "https://example.com" },
    { baseUrl: `http://localhost:57446/${slot}` },
    { baseUrl: "http://127.0.0.1:57446/openai-codex-account-2" },
    { baseUrl: `${model.baseUrl}?token=unknown` },
  ])
    assert.equal(verifiedCodexSlotRoute({ ...current, ...patch }, publication), undefined);
  assert.equal(
    verifiedCodexSlotRoute(current, { providers: { [slot]: { baseUrl: model.baseUrl, apiKey: "unknown" } } }),
    undefined,
  );
});

test("unconfigured numbered sessions ignore global Fast and do not overwrite an existing service tier", async (t) => {
  const f = await fixture(t, true);
  assert.deepEqual(f.fast.availability(f.current.ctx.model), { kind: "available", enabled: false });
  assert.equal(f.fast.decorateStatus(f.current.ctx.model, "codex 0% 39.57k"), "codex 0% 39.57k");
  assert.equal(await f.fire("before_provider_request", { payload: { service_tier: "flex" } }), undefined);
  assert.equal(f.mock.entries.length, 0);
});

test("/codex-fast without arguments toggles numbered requests and decorates only the existing usage status", async (t) => {
  const f = await fixture(t, false);
  const payload = { model: model.id, input: [], service_tier: "flex" };
  await f.command("codex-fast");
  assert.deepEqual(await f.fire("before_provider_request", { payload }), { ...payload, service_tier: "priority" });
  assert.equal(payload.service_tier, "flex");
  assert.equal(f.fast.decorateStatus(f.current.ctx.model, "codex 0% 39.57k"), "codex fast 0% 39.57k");
  await f.command("codex-fast");
  assert.deepEqual(await f.fire("before_provider_request", { payload }), { ...payload, service_tier: "default" });
  assert.deepEqual(f.mock.entries, [
    { customType: "codex-fast", data: { enabled: true } },
    { customType: "codex-fast", data: { enabled: false } },
  ]);
  assert.equal(f.fast.decorateStatus(f.current.ctx.model, "codex 0% 39.57k"), "codex 0% 39.57k");
  assert.equal(f.current.statuses.size, 0, "Fast controls must not create a separate footer item");
});

test("legacy on/off/status commands separate requested priority from the observed server tier", async (t) => {
  const f = await fixture(t);
  await f.command("codex-fast", "on");
  await f.fire("before_provider_request", { payload: { input: [] } });
  await f.command("codex-fast", "status");
  assert.match(f.current.notifications.at(-1)?.message ?? "", /priority; server tier: not reported/);
  await f.fire("provider_stream_event", {
    provider: "openai-codex-account-2",
    model: model.id,
    data: { type: "response.completed", response: { service_tier: "priority" } },
  });
  await f.command("codex-fast", "status");
  assert.match(f.current.notifications.at(-1)?.message ?? "", /server tier: not reported/);
  await f.fire("provider_stream_event", {
    provider: slot,
    model: model.id,
    data: { type: "response.completed", response: { service_tier: "default" } },
  });
  await f.command("codex-fast", "status");
  assert.match(
    f.current.notifications.at(-1)?.message ?? "",
    /Session next request: priority[\s\S]*priority; server tier: default/,
  );
  await f.command("codex-fast", "off");
  await f.command("codex-fast", "status");
  assert.match(f.current.notifications.at(-1)?.message ?? "", /Session next request: default/);
  assert.equal(
    await f.fire("message_end", { message: { role: "assistant", provider: slot, model: model.id } }),
    undefined,
    "numbered mode must not apply base-provider cost multipliers",
  );
});

test("TUI status command emphasizes preference and a confirmed server-tier mismatch only", async (t) => {
  const f = await fixture(t);
  await f.command("codex-fast", "on");
  await f.fire("before_provider_request", { payload: {} });
  await f.fire("provider_stream_event", {
    provider: slot,
    model: model.id,
    data: { type: "response.completed", response: { service_tier: "default" } },
  });
  const command = f.mock.commands.get("codex-fast");
  assert.ok(command);
  const tuiContext = {
    ...f.current.ctx,
    mode: "tui",
    ui: {
      ...f.current.ctx.ui,
      theme: {
        fg: (role: string, text: string) => `<${role}>${text}</${role}>`,
        bold: (text: string) => `<bold>${text}</bold>`,
      },
    },
  };
  await command.handler("status", tuiContext);
  const message = f.current.notifications.at(-1)?.message ?? "";
  assert.match(message, /Session next request: <bold><accent>priority<\/accent><\/bold>/);
  assert.match(message, /<warning>Last observed request: priority; server tier: default<\/warning>/);
  assert.doesNotMatch(message, /<accent>Current model/);
});

test("old session entries restore after resume and branch changes remove abandoned preferences", async (t) => {
  const f = await fixture(t, false, true);
  assert.deepEqual(await f.fire("before_provider_request", { payload: {} }), { service_tier: "priority" });
  assert.equal(f.mock.entries.length, 0, "restoring must not append another preference");
  await f.fire("session_start");
  assert.equal(f.fast.decorateStatus(f.current.ctx.model, "codex"), "codex fast");
  f.replaceBranch();
  await f.fire("session_tree");
  assert.equal(await f.fire("before_provider_request", { payload: {} }), undefined);
  assert.equal(f.fast.decorateStatus(f.current.ctx.model, "codex"), "codex");
});

test("lost publication, invalid arguments and aborted toggles cannot change the request", async (t) => {
  const f = await fixture(t);
  await f.command("codex-fast", "on extra");
  assert.equal(f.mock.entries.length, 0);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await f.fast.toggle(f.current.ctx, true, controller.signal), false);
  assert.equal(f.mock.entries.length, 0);
  await f.command("codex-fast", "on");
  writeFileSync(join(directory, "models.json"), "{}");
  assert.equal(await f.fire("before_provider_request", { payload: {} }), undefined);
  assert.equal(f.fast.decorateStatus(f.current.ctx.model, "codex"), "codex");
  await f.command("codex-fast", "off");
  assert.equal(f.mock.entries.length, 1);
  await f.fire("session_shutdown");
  assert.equal(await f.fire("before_provider_request", { payload: {} }), undefined);
});

test("headless direct controls reject before mutation and offer completions in interactive modes", async (t) => {
  const f = await fixture(t);
  const command = f.mock.commands.get("codex-fast");
  assert.ok(command);
  assert.deepEqual(command.getArgumentCompletions?.("o"), [
    { value: "on", label: "on" },
    { value: "off", label: "off" },
  ]);
  await assert.rejects(
    Promise.resolve(command.handler("on", { ...f.current.ctx, hasUI: false, mode: "print" })),
    /TUI or RPC/,
  );
  assert.equal(f.mock.entries.length, 0);
});
