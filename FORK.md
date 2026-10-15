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

- Source changes: `packages/pi-usage/src/{codex-slot-auth,query,usage,types}.ts`.
- Regression cases: `packages/pi-usage/test/codex-slot.test.ts`; upstream generated-entry/build tests cover bundled runtime loading. Test credentials are synthetic.
- Use the repository's native Vitest/TypeScript tooling; never import a generated chunk by its content-hashed filename.
- Run `npm run check` and `npm test`; pack using `npm run package:pack -- usage` and load the built package with Pi before switching production.
- Keep `upstream` pointing to the URL above. Fetch reviewed tags into a clean checkout, merge into a separate upgrade branch, resolve conflicts in source only, rebuild, and rerun checks before advancing this maintenance branch. Never force-sync over fork commits.
- Watch Pi auth/model-registry APIs, pi-multi-account sidecar identity/placeholder changes, Codex usage schemas, and dynamic bundle imports. Keep defaults for unmodified providers unchanged.
- Preserve licenses. Do not run upstream publish workflows or publish packages under the upstream npm namespace.

To roll back, check out the previous known-good commit, reinstall locked dependencies, rebuild pi-usage and pi-tui-kit, and restart Pi. Keep user auth/settings/state intact. The deployment handoff records the exact verified commit and any baseline or environment check failures; do not treat a skipped gate as passing.

## Migration verification

- Full repository `npm run check` passed with the pinned toolchain.
- Full `npm test`: 590 files, 8461 passed, 8 upstream skips. The machine's older default npm failed unrelated installation-policy tests; using the repository's pinned Node/npm resolved them without weakening the policy.
- pi-usage alone: 38 files, 635 passed, including account-isolation tests. Build/pack checks inspect generated relative imports and exclude source-forwarding runtime patches.
- Real installed Pi process loaded both fork package directories and registered `/usage` and `/multi-account`, in a temporary agent directory without real credentials. A synthetic-credential usage smoke received HTTP 401 because its transport stub was ineffective; it was stopped, not retried against the provider. No paid inference was sent; report semantics are covered by deterministic tests. After switching production, the user's normal messages provide the live end-to-end confirmation.
