# 📊 Pi Extensions — Datalater's pi-usage Fork

[![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![Upstream npm scope](https://img.shields.io/badge/upstream_npm-@narumitw-blue)](https://www.npmjs.com/org/narumitw) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

This is a personal fork of [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions), maintained for **`pi-usage` support for numbered Codex accounts**. It lets `/usage` show the selected account's included allowance and credit balance without falling back to another account's credentials.

**Why is the repository called `pi-extensions`?** `pi-usage` lives at [`packages/pi-usage`](./packages/pi-usage) inside the upstream monorepo. This fork keeps that layout, shared build tooling, and history so upstream changes can be merged. Other packages remain available as upstream source, but they are not the focus of this fork.

> [!IMPORTANT]
> Install **`packages/pi-usage`**, not the repository root. The root Pi manifest enables many unrelated extensions.
> The upstream npm package `@narumitw/pi-usage` does **not** contain this fork's changes.

## ✨ What this fork changes

- Recognizes the selected `openai-codex-account-N` as its own account, rather than reporting it as unsupported.
- Shows included quota and credits together, including when included quota has reached zero.
- Places compact credit balance immediately after the quota windows in one status item, e.g. `codex 5h:80% · wk:60% 43.29k`, without a separate label or status block.
- Colors the Codex status using Pi's quota theme roles: error at zero remaining, warning below 20%, success otherwise. Color describes included quota, not credit availability.
- Identifies the account with a minimal lowercase `codex a3` label in the existing quota-colored TUI usage row and emphasizes just account/credits in `/usage`, without replacing the built-in footer.
- Owns numbered-account Fast toggles and detail status too: `/codex-fast` toggles priority intent, and `/codex-fast on|off|status` sets or inspects it explicitly, and the same usage item shows `codex fast …`.
- Reads only the selected slot's credentials and validates them against the runtime account and endpoint.
- Refuses missing, expired, or mismatched credentials instead of displaying another account's balance.
- Builds the runtime from source; there are no hand-edited generated chunks or machine-specific test imports.

This extension **reports usage**. It does not decide whether inference may spend credits or which account handles a request. The separate [datalater/pi-multi-account](https://github.com/datalater/pi-multi-account) fork owns the opt-in `allowCodexCredits` policy and failover behavior.

## 📦 Install this fork

Use the maintained branch, `datalater/codex-slots`:

```bash
git clone --branch datalater/codex-slots https://github.com/datalater/pi-extensions.git
cd pi-extensions
```

Use the Node.js version in [`.node-version`](./.node-version) and the npm version pinned in [`scripts/check-install-policy.mjs`](./scripts/check-install-policy.mjs), then run from the repository root:

```bash
node scripts/check-install-policy.mjs
npm ci
npm --workspace @narumitw/pi-tui-kit run build
npm --workspace @narumitw/pi-usage run build
pi install "$PWD/packages/pi-usage"
```

If Pi already lists `npm:@narumitw/pi-usage` in `settings.json`, **replace that declaration** with the built local package path instead of loading both copies. Confirm the selected source with `pi list`.

To try the built package without saving an installation:

```bash
pi --no-extensions -e ./packages/pi-usage
```

Fully quit and relaunch/resume Pi after switching loaded code. Local checkouts are not replaced by npm when running `pi update --extensions`; you maintain and build this checkout yourself. Extensions run with your user permissions, so review the source before installing.

## 🚀 Quick start

1. Authenticate and select a numbered Codex account through your account manager.
2. Run `/usage` in Pi's TUI or RPC mode.
3. Confirm that the report names the selected numbered account and displays its quota and credits.

The configured-provider picker is unchanged: select the numbered model first, then query its usage. `/usage` reports a snapshot, not a guarantee that the next inference request will succeed or that a recent charge has already been reflected.

See the [pi-usage README](./packages/pi-usage/README.md) for all commands, supported providers, settings, and security details. Numbered slots support explicit session Fast requests on verified proxy routes; `/codex-fast status` distinguishes requested priority from the observed server tier. Remove the old local `codex-fast.ts` helper to avoid duplicate commands/statuses. Reset redemption is not enabled for numbered slots.

## 🔒 Compatibility and safety

Numbered-slot reporting intentionally depends on pi-multi-account's private OAuth sidecar and proxy-placeholder format. This is a **fork-specific exception**, not an upstream extension-neutral protocol. It needs revalidation when either extension changes its account storage or proxy routing.

The slot adapter only queries the official Codex usage endpoint, checks account identity around the request, and refuses redirects. It does not refresh or write credentials, purchase credits, redeem resets, or modify billing settings. Never commit real auth files, usage logs, or account balances to this repository.

## 🛠️ Maintain and verify

```bash
npm run check
npm test
npm run package:pack -- usage
```

These are the repository's existing build, typecheck, lint, test, and packaging workflows. Use the pinned toolchain for the full suite; an older npm does not implement the installation-policy features tested here.

For upstream updates, work on a clean upgrade branch, merge a reviewed upstream revision, rebuild, and run the checks before advancing `datalater/codex-slots`. Do not force-sync over the fork commits. Keep the last working commit available for rollback.

[FORK.md](./FORK.md) contains the detailed update/rollback procedure and migration verification evidence. Package names and versions remain upstream-compatible; use `git rev-parse HEAD` to identify the fork revision. This fork is not published under a new npm scope, and upstream release workflows must not be used to publish it without separate approval.

## 🗂️ Repository layout

```text
packages/pi-usage/       Maintained usage-reporting changes and regression tests
packages/pi-tui-kit/     Shared UI library needed by the local package build
packages/               Other upstream packages retained for history/tooling
scripts/                Shared build, checks, tests, and packaging workflows
test/                   Repository integration tests
docs/                   Upstream conventions and dependency policy
FORK.md                 Fork maintenance and verification notes
```

For unrelated extensions and their upstream installation instructions, see the [upstream package catalog](https://github.com/narumiruna/pi-extensions#-choose-an-extension).

## 📄 License and attribution

MIT. See [LICENSE](./LICENSE) and the [package license](./packages/pi-usage/LICENSE). Original extensions and tooling are maintained by [narumiruna and upstream contributors](https://github.com/narumiruna/pi-extensions); this fork maintains the numbered-Codex usage integration.
