import assert from "node:assert/strict";
import { test } from "vitest";
import { codexQuotaStatusColor } from "../src/format.js";
import { formatUsageReport, formatUsageStatusline, normalizeCodexBackendPayload } from "../src/index.js";

function report(balance?: string | number) {
  return normalizeCodexBackendPayload(
    {
      rate_limit: {
        primary_window: { used_percent: 20, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 40, limit_window_seconds: 604_800 },
      },
      credits: balance === undefined ? undefined : { has_credits: true, balance },
    },
    1000,
  );
}

test("Codex windows and compact balance share one status item with a single space", () => {
  const usage = report("43287.1525145000");
  for (const provider of ["openai-codex", "openai-codex-account-3"]) {
    assert.equal(
      formatUsageStatusline(usage, { provider, id: "test-model", name: "Test model" }, 1000, false),
      "codex 5h:80% · wk:60% 43.29k",
    );
  }
  assert.match(formatUsageReport(usage, "current"), /43287\.1525145/);
});

test("compact credits preserve changes, rounded unit boundaries, zero and unlimited balances", () => {
  for (const [balance, suffix] of [
    ["43270", "43.27k"],
    ["40000", "40.00k"],
    ["999.995", "1.00k"],
    ["999994", "999.99k"],
    ["999995", "1.00M"],
    ["1256789", "1.26M"],
    ["12.345", "12.35"],
    ["0.004", "<0.01"],
    ["0", "0"],
  ]) {
    assert.equal(formatUsageStatusline(report(balance), undefined, 1000, false), `codex 5h:80% · wk:60% ${suffix}`);
  }
  const unlimited = report();
  unlimited.metrics.push({ id: "credits", label: "Credits", value: "unlimited" });
  assert.equal(formatUsageStatusline(unlimited, undefined, 1000, false), "codex 5h:80% · wk:60% ∞");
});

test("unknown and invalid balances do not add a misleading zero or trailing space", () => {
  for (const value of [undefined, "available", -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const usage = report();
    if (value !== undefined) usage.metrics.push({ id: "credits", label: "Credits", value });
    assert.equal(formatUsageStatusline(usage, undefined, 1000, false), "codex 5h:80% · wk:60%");
  }
});

test("quota color follows the displayed Codex group, not credits or a missing quota", () => {
  const usage = normalizeCodexBackendPayload(
    {
      rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 604_800 } },
      credits: { has_credits: true, balance: "39570" },
      additional_rate_limits: [
        {
          limit_name: "GPT-5.3 Codex Spark",
          metered_feature: "gpt-5.3-codex-spark",
          rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18_000 } },
        },
      ],
    },
    1000,
  );
  assert.equal(
    codexQuotaStatusColor(usage, { provider: "openai-codex-account-3", id: "model", name: "Model" }),
    "error",
  );
  assert.equal(
    codexQuotaStatusColor(usage, { provider: "openai-codex", id: "gpt-5.3-codex-spark", name: "Codex Spark" }),
    "success",
  );
  assert.equal(codexQuotaStatusColor({ ...usage, providerId: "openrouter" }), undefined);
  assert.equal(codexQuotaStatusColor({ ...usage, buckets: [] }), undefined);
  const unknown = report();
  unknown.buckets[0].remaining = undefined;
  assert.equal(codexQuotaStatusColor(unknown), undefined);
});

test("credit-only reports stay compact while an empty quota template stays hidden", () => {
  const usage = report("43287.15");
  assert.equal(
    formatUsageStatusline(usage, undefined, 1000, false, "remaining", {
      template: "",
      window: "{window}:{value}",
      countdown: "{value} ↻ {reset}",
      separator: " · ",
    }),
    "",
  );
  usage.buckets = [];
  assert.equal(formatUsageStatusline(usage), "codex 43.29k");
});
