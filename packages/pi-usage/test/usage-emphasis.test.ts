import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionCommandContext, ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defineMenu, runMenu } from "@narumitw/pi-tui-kit";
import { createTuiHarness } from "@narumitw/pi-tui-kit/testing";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { emphasizeCodexStatus, emphasizeFastDetails, withUsageEmphasis } from "../src/usage-emphasis.js";

function theme() {
  const calls: Array<{ role: ThemeColor; text: string }> = [];
  return {
    calls,
    fg: (role: ThemeColor, text: string) => {
      calls.push({ role, text });
      const code =
        role === "accent" ? 36 : role === "mdLink" ? 34 : role === "syntaxKeyword" ? 35 : role === "error" ? 31 : 90;
      return `\x1b[${code}m${text}\x1b[0m`;
    },
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };
}

test("TUI account labels are lowercase and share quota severity without badges or bold", () => {
  for (const slot of [1, 2, 3]) {
    const palette = theme();
    const ctx = createMockContext({ mode: "tui", theme: palette, model: { provider: `openai-codex-account-${slot}` } })
      .ctx as ExtensionContext;
    const value = emphasizeCodexStatus(ctx, "codex fast 0% 39.57k", "error");
    assert.equal(stripVTControlCharacters(value ?? ""), `codex a${slot} fast 0% 39.57k`);
    assert.deepEqual(palette.calls, [{ role: "error", text: `codex a${slot} fast 0% 39.57k` }]);
    assert.ok(!value?.includes("\x1b[1m"));
    assert.equal(emphasizeCodexStatus(ctx, "codex fast 0% 39.57k", "error"), value);
    assert.equal(emphasizeCodexStatus(ctx, "checking"), "checking");
    assert.equal(emphasizeCodexStatus(ctx, undefined), undefined);
  }
});

test("RPC, other providers and the built-in footer remain unchanged", () => {
  const palette = theme();
  const rpc = createMockContext({ mode: "rpc", theme: palette, model: { provider: "openai-codex-account-3" } })
    .ctx as ExtensionCommandContext;
  assert.equal(emphasizeCodexStatus(rpc, "codex 80%"), "codex 80%");
  assert.equal(withUsageEmphasis(rpc), rpc);
  const other = createMockContext({ mode: "tui", theme: palette, model: { provider: "openrouter" } })
    .ctx as ExtensionContext;
  assert.equal(emphasizeCodexStatus(other, "openrouter $10"), "openrouter $10");
});

test("Fast details highlight one setting and only a confirmed server mismatch", () => {
  const palette = theme();
  const ctx = createMockContext({ mode: "tui", theme: palette }).ctx as ExtensionContext;
  const lines = [
    "Session next request: priority",
    "Current model: model",
    "Last observed request: priority; server tier: default",
    "Explanation",
  ];
  assert.equal(stripVTControlCharacters(emphasizeFastDetails(ctx, lines)), lines.join("\n"));
  assert.ok(palette.calls.some((call) => call.role === "accent" && call.text === "priority"));
  assert.ok(palette.calls.some((call) => call.role === "warning" && call.text.startsWith("Last observed")));
  for (const server of ["priority", "not reported"]) {
    palette.calls.length = 0;
    emphasizeFastDetails(ctx, [`Last observed request: priority; server tier: ${server}`]);
    assert.equal(palette.calls.length, 0);
  }
  const rpc = createMockContext({ mode: "rpc", theme: palette }).ctx as ExtensionContext;
  assert.equal(emphasizeFastDetails(rpc, lines), lines.join("\n"));
});

test("real Kit menu emphasizes sanitized account and credit values with bounded resize and cancellation", async () => {
  const palette = theme();
  const tui = createTuiHarness({ width: 68, rows: 30, theme: palette });
  const created = createMockContext({ hasUI: true, mode: "tui", model: { provider: "openai-codex-account-3" } });
  const base = created.ctx as ExtensionCommandContext;
  const ctx = { ...base, ui: { ...base.ui, custom: tui.custom } } as ExtensionCommandContext;
  const menu = defineMenu<undefined, "main", never>({
    start: "main",
    screens: {
      main: () => ({
        kind: "actions",
        title: "Provider usage",
        lines: ["Account: openai-codex-account-3\x1b[31m", "Credits:                     39570", "Plan: pro"],
        items: [{ id: "close", label: "Close", close: true }],
      }),
    },
    actions: {},
  });
  const running = runMenu(withUsageEmphasis(ctx), menu, { getState: () => undefined });
  await tui.waitForOpen();
  try {
    const lines = tui.render();
    const plain = stripVTControlCharacters(lines.join("\n"));
    assert.match(plain, /Account: openai-codex-account-3/);
    assert.ok(palette.calls.some((call) => call.role === "text" && call.text.startsWith("openai-codex-account-3")));
    assert.ok(palette.calls.some((call) => call.role === "accent" && call.text === "39570"));
    assert.ok(
      !palette.calls
        .filter((call) => call.text.startsWith("openai-codex-account-3"))
        .some((call) => call.text.includes("\x1b")),
    );
    assert.ok(palette.calls.some((call) => call.role === "muted" && call.text === "Plan: pro"));
    for (const width of [68, 24, 8, 1]) {
      tui.resize({ width });
      assert.ok(tui.render().every((line) => visibleWidth(line) <= width));
    }
    await tui.press("ctrl+c");
    await running;
  } finally {
    await tui.dispose();
  }
});
