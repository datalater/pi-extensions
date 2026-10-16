# Datalater pi-usage maintenance branch

Upstream: https://github.com/narumiruna/pi-extensions

Branch: `datalater/codex-slots`, based on `@narumitw/pi-usage@0.66.0`. Only pi-usage is customized. Keep upstream history and package identities; identify the deployed fork with `git rev-parse HEAD`. No upstream npm publication, release tag, or release workflow is part of this migration.

## Install just pi-usage

```sh
git clone --branch datalater/codex-slots https://github.com/datalater/pi-extensions.git
cd pi-extensions
# Use the Node version in .node-version and npm pinned in scripts/check-install-policy.mjs.
node scripts/check-install-policy.mjs
npm ci
npm run check
npm test
npm run package:pack -- usage
pi install "$PWD/packages/pi-usage"
```

Replace the existing `npm:@narumitw/pi-usage@...` declaration in Pi settings, not alongside it. Do not install the monorepo root: its manifest loads many unrelated extensions. The package directory requires generated `dist` output; `npm run check` builds it. The bundle is generated from source, never manually patched or forwarded back into `src`. Local sources are not replaced by `pi update --extensions`. Extensions run with Pi's privileges. Fully restart Pi after changing the loaded checkout.

## Scope and compatibility exception

The selected numbered Codex slot is an independent account, not an alias to the base account. The helper reads pi-multi-account's private sidecar and recognizes its placeholder on an exact loopback route. This intentionally deviates from the upstream extension-neutral integration rule; it is maintained only as a personal-fork compatibility layer, without a runtime package dependency on the other extension. When the sidecar is absent, only the same slot in Pi auth is considered. No credential refresh/write, reset redemption, or billing change is performed.

Read the pi-usage README's numbered-slot security section before changing authentication logic. Do not add real credentials, auth files, local logs, balances, or machine-specific test aliases to this repository.

## Verification and update routine

- Fork-owned source includes `packages/pi-usage/src/{codex-slot-auth,codex-fast-runtime,query,usage,types,format,usage-emphasis}.ts`.
- Regression cases include `packages/pi-usage/test/{codex-slot,codex-slot-fast,codex-credit-statusline,usage}.test.ts`: account isolation, startup recovery, inline balance, quota colors, numbered Fast controls and old session-entry restoration. Upstream generated-entry/build tests cover bundled runtime loading. Test credentials are synthetic.
- Use the repository's native Vitest/TypeScript tooling; never import a generated chunk by its content-hashed filename.
- Run `npm run check` and `npm test`; pack using `npm run package:pack -- usage` and load the built package with Pi before switching production.
- Keep `upstream` pointing to the URL above. Fetch reviewed tags into a clean checkout, merge into a separate upgrade branch, resolve conflicts in source only, rebuild, and rerun checks before advancing this maintenance branch. Never force-sync over fork commits.
- Watch Pi auth/model-registry APIs, pi-multi-account sidecar identity/placeholder changes, Codex usage schemas, and dynamic bundle imports. Keep defaults for unmodified providers unchanged.
- Preserve licenses. Do not run upstream publish workflows or publish packages under the upstream npm namespace.

To roll back, check out the previous known-good commit, reinstall locked dependencies, rebuild pi-usage and pi-tui-kit, and restart Pi. Keep user auth/settings/state intact. The deployment handoff records the exact verified commit and any baseline or environment check failures; do not treat a skipped gate as passing.

## What maintenance actually involves

This fork maintains **usage reporting and Fast request controls**, not model registration, account routing, or credit-eligibility policy. A new model ID alone usually does not require changing the usage adapter. The companion [pi-multi-account fork](https://github.com/datalater/pi-multi-account) and Pi own catalog discovery and model-selection policy.

### Automatic behavior versus manual work

| Item | Existing behavior | Maintenance trigger |
| --- | --- | --- |
| New numbered Codex slots | Slot IDs are recognized by pattern, not a hard-coded account list | Check only if the account manager changes naming, sidecar layout, placeholder identity or runtime auth behavior. |
| Quota and credit values | Read from provider responses; no hand-maintained balance table | Update normalization if fields, units, windows, optional data or endpoints change. |
| New model IDs | General Codex quota parsing is not an ID-by-ID model list | Review model-specific quota group matching when the provider introduces new groups or names. |
| Codex Fast eligibility | Basic official `openai-codex` support is discovered from account model metadata | Check service-tier/capability schema changes, not just each new name. Numbered slots instead use explicit session intent on verified loopback routes; do not mistake that intent for catalog-confirmed support. |
| Fast cost estimates | `src/codex-fast.ts` still contains model-dependent multipliers | Review provider pricing/tier changes; do not assume capability discovery also keeps price estimation current. |
| Display preferences | `pi-usage.json` owns templates, used/remaining percentages and countdown settings | Edit when personal presentation preferences change; no code change is normally needed. |
| Pi runtime and UI support | Uses host auth/registry/UI APIs and pi-tui-kit | Review host compatibility, session cancellation, rendering, and library changes on upgrade. |

The displayed **credit balance is provider-reported**, not derived from our token-price estimate. A stale Fast cost multiplier does not numerically determine that balance. Likewise, a quota snapshot does not prove that a future inference request will be accepted or identify the cost of one particular message.

### What upstream was changing — observed 2026-10-15

This is a dated investigation snapshot; check current history rather than treating it as a permanent latest-version claim:

- Our baseline and the latest observed pi-usage release were `0.66.0`. No later change to `packages/pi-usage` was found on upstream main at inspection time.
- October 9: explicit support was added for [`gpt-6.1-sol`](https://github.com/narumiruna/pi-extensions/commit/5cf3ee24) and [Astra/Luna Fast mode](https://github.com/narumiruna/pi-extensions/commit/d752df0c).
- October 10: [Fast eligibility moved to account model metadata](https://github.com/narumiruna/pi-extensions/commit/13277d67), reducing the need for release-per-model allowlist updates.
- October 11–13: upstream fixed [Fast discovery cancellation](https://github.com/narumiruna/pi-extensions/commit/52d2d261), added [provider countdowns](https://github.com/narumiruna/pi-extensions/commit/d5e3772f) and introduced [statusline templates](https://github.com/narumiruna/pi-extensions/commit/3b21c1ea).
- Other recent work covered ChatGPT plan/app quota separation, companion authentication checks, timeout recovery and Pi SDK compatibility.
- The monorepo continued changing shared tooling and pi-tui-kit after the pi-usage release. Those changes can matter to our build/runtime even when pi-usage itself is unchanged.

These Fast/template changes are already part of the baseline; this list is evidence of maintenance patterns, not an unmerged feature backlog.

### What to watch in this monorepo

Prioritize these paths and their actual dependencies:

- `packages/pi-usage/`: provider adapters, authentication, status formatting and lifecycle.
- `packages/pi-tui-kit/`: shared menu/loading/rendering behavior used by pi-usage.
- `scripts/`, root manifests/lockfile and TypeScript/test configuration: build and validation compatibility.
- `.node-version`, installation-policy scripts and dependency/security changes: the supported development toolchain.

Unrelated extensions' feature requests are **not our maintenance backlog** merely because they share the repository. Keep them for upstream history/tooling, but do not independently develop or install them as part of pi-usage maintenance. Shared build checks can still expose pre-existing failures in unrelated packages; reproduce on an unchanged baseline and report them separately rather than weakening tests or claiming all gates passed.

### Trigger-based review routine

- **New model release:** normally no usage-code edit. Check the model's quota grouping and, if using base-provider `/codex-fast`, advertised tier support and cost estimates. Personal default/cycling preferences belong to Pi, not this package.
- **Usage looks wrong or fields disappear:** compare the usage endpoint and response-header contracts. Keep missing values distinct from zero; do not infer that every Pro account has the same quota windows.
- **After updating the account-manager fork:** retest exact-slot credential resolution, placeholder/origin validation, credential rotation and refusal of wrong-account data. This private compatibility layer is one of our main fork-specific responsibilities.
- **After updating Pi or UI libraries:** verify startup/resume before the first prompt, superseded-session cancellation, error status, theme colors and menu operation in supported modes.
- **Periodically (for example every two weeks):** review relevant releases, dependency security notes and shared-library changes. Merge selectively, rebuild, then restart Pi; local checkout installation deliberately opts out of automatic npm replacement.

Read-only upstream review commands:

```sh
git fetch upstream --tags
git log --oneline HEAD..upstream/main -- packages/pi-usage packages/pi-tui-kit scripts package.json package-lock.json .node-version
git diff HEAD...upstream/main -- packages/pi-usage packages/pi-tui-kit scripts package.json package-lock.json .node-version
```

The three-dot diff isolates upstream-side changes since the common ancestor. Review fork-side changes as well before merging. No upstream merge or live setting change is implied by this review.

### Fork guarantees to recheck after updates

- One selected numbered account, no base-account credential fallback, and no secret-bearing logs.
- Quota and compact credit balance in one status item; detailed `/usage` retains precision.
- Theme colors represent included quota, not credit eligibility; unknown quota is not colored as known headroom. In TUI, the lowercase `codex a3` account label shares the quota color, without brackets or bold; Pi's built-in footer is unchanged.
- TUI `/usage` highlights sanitized account/credit values at the Kit render boundary without allowing untrusted ANSI through. `/codex-fast status` highlights the requested setting and only confirmed server-tier mismatches. RPC remains plain text; verify narrow resizing, hard cancellation and theme-aware re-rendering using `usage-emphasis.test.ts`.
- Startup/resume queries without requiring a prompt; identity-change retries are bounded and cancelled owners cannot publish.
- No extra inference request, credit purchase, or reset redemption merely to refresh the display.
- The retired `compact-codex-quota.ts` and `codex-fast.ts` remain disabled. Multi-account polling stays enabled while its separate footer is hidden using `showUsageStatusline: false`.
- `/codex-fast` (no arguments toggles) and explicit `on|off|status` preserve numbered-slot session intent and legacy `codex-fast` custom entries without modifying base-provider JSON preferences. Only verified proxy routes are rewritten. Last server tier is observed data, not inferred from the requested mode; no second status item or synthetic cost multiplier is added.

## Migration verification (historical)

- Full repository `npm run check` passed with the pinned toolchain.
- Full `npm test`: 590 files, 8461 passed, 8 upstream skips. The machine's older default npm failed unrelated installation-policy tests; using the repository's pinned Node/npm resolved them without weakening the policy.
- pi-usage alone: 38 files, 635 passed, including account-isolation tests. Build/pack checks inspect generated relative imports and exclude source-forwarding runtime patches.
- Real installed Pi process loaded both fork package directories and registered `/usage` and `/multi-account`, in a temporary agent directory without real credentials. A synthetic-credential usage smoke received HTTP 401 because its transport stub was ineffective; it was stopped, not retried against the provider. No paid inference was sent; report semantics are covered by deterministic tests. After switching production, the user's normal messages provide the live end-to-end confirmation.
