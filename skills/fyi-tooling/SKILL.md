---
name: fyi-tooling
description: "Building, testing and shipping vym.fyi — what cargo test actually covers (and the large gap it leaves), which CI jobs gate a merge and which do not, the two commit-message checks and why the second exists, release-please with a virtual workspace, cargo-deny's deliberately empty ignore list, and the helm-publish trigger that does not fire on tags. Load before running the suite, adding a CI job, writing a commit message, or cutting a release."
---

# fyi-tooling

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

## Local commands

```bash
cargo check --all-targets --all-features
cargo test --workspace --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all
cargo llvm-cov --workspace --all-features --fail-under-lines 70
cargo deny check advisories
cargo deny check bans licenses sources
```

`pre-commit` (`.pre-commit-config.yaml`) runs `cargo check`, `cargo fmt --all`
and `cargo clippy -D warnings` on Rust changes.

## What the test suite actually covers

**No test in the workspace touches Postgres.** There is no `sqlx::test`
anywhere, and `sqlx` uses runtime-checked queries, so nothing validates a
query against a real schema at any point — build time or test time.

The complete inventory:

| Where                                         | What                                                  |
| --------------------------------------------- | ----------------------------------------------------- |
| `vym-fyi-server-crud/src/handlers/links.rs`   | 2 tests — the two strategies against a stub           |
| `vym-fyi-model/src/services/config.rs`        | 2 tests — placeholder substitution, missing-var error |
| `vym-fyi-model/src/services/query_adapter.rs` | builder behaviour                                     |
| `vym-fyi-model/src/services/http_client.rs`   | singleton identity via `std::ptr::eq`                 |
| `vym-fyi-model/tests/config_flow.rs`          | load + resolve, end to end against a temp file        |
| `vym-fyi-server-redirect/src`                 | **nothing at all**                                    |

So: the routes, the auth extractor, the tenant sync, the query builder, the
status mapping, the tenant scoping, slug generation and the whole redirect
service are untested. A green suite here is a weak signal — treat "I changed
it and tests pass" as meaning very little, and verify against a real database
by hand.

## CI

### `ci.yml` — "Code Linting and SAST", push and PR to `main`

| Job           | Runs                                                                                                                           | Gates?                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `lint`        | super-linter: GitHub Actions, **zizmor**, gitleaks, merge markers, Trivy, YAML                                                 | yes                               |
| `sast`        | `cargo-deny check` — matrix `advisories` \| `bans licenses sources`                                                            | **advisories: NO**, the rest: yes |
| `code-checks` | `cargo check --all-targets --all-features`; `cargo fmt -- --check`; `cargo clippy --all-targets --all-features -- -D warnings` | yes                               |
| `tests`       | `cargo test --workspace --all-targets`                                                                                         | yes                               |

> **The `advisories` leg carries `continue-on-error: true`.** A new RUSTSEC
> advisory shows up as a green run with a red step nobody has to act on.
> `bans licenses sources` does gate.

**Clippy gates on `-D warnings`** here, unlike the sibling `image-resizer`
repo. A new warning fails the build.

### `quality.yml` — PR to `main`

Calls the org-wide reusable workflows in `vaam-apps/.github` (`sast.yml`,
`lint.yml`, `trivy.yml`), each behind a `dorny/paths-filter` `changes` job.
Two comments in it are worth internalising, because both are general:

- Gating is a per-job `if:` over a paths-filter job, **never**
  `on.pull_request.paths` — a skipped job still reports and satisfies a
  required check; a workflow that never triggers reports nothing and blocks
  the PR forever on a check that will never arrive.
- Filters are **positive lists**, never `'**'` plus `'!'` exclusions —
  paths-filter ORs its rules through picomatch, so `'**'` matches everything
  and the negations never subtract.

### `build.yml` — Docker

Matrix over the `crud` and `redirect` targets. Two Trivy scans, both
`exit-code: 1` and therefore both real gates: a **config** scan of the
Dockerfile (CRITICAL/HIGH) before the build, and a **vulnerability** scan of
the built image after. The push step is skipped on `pull_request`, and the
image scan runs after it — so on a PR the image scan has nothing to scan.

### The rest

- **`release.yml`** builds `vym-fyi-client` for both musl targets and, on a
  `v*` tag, `gh release upload --clobber`s the binaries onto the release
  release-please created. It deliberately does **not** create the release
  itself.
- **`helm-publish.yml`** is triggered by `main` **and** `v*` tags, but its
  `chart-releaser` step is `if: github.ref == 'refs/heads/main'` — so
  **pushing a tag does not publish a chart.** Worth knowing before you wait
  for one.
- **`docs.yml`** runs `mkdocs build --strict` — strict, so a warning fails —
  and deploys to `gh-pages` under `docs/` on `main`.
- **`issue-governance.yml`** validates issue structure, `enforce: true`.

## The two commit-message checks

`pr-title.yml`:

- **`conventional-title`** regex-checks the PR title. The title reaches the
  script through `env:`, **never** `${{ }}` inside a `run:` — a PR title is
  attacker-controlled text and `${{ }}` in a shell body is textual
  substitution, so a title with a quote and a semicolon would execute.
- **`commit-message-parses`** runs the **whole would-be squash message**
  through release-please's own parser, `@conventional-commits/parser` pinned
  to `0.4.1` (the only version satisfying release-please's `^0.4.1`).

The second exists because **a body line can make release-please discard the
entire commit — silently, with the workflow green.** Its PEG grammar reads a
line beginning `identifier(` as a type-and-scope header, and a nested `(`
inside it is a syntax error. Start body lines with a word, not a
function-call-shaped token.

## release-please

`release-type: **simple**`, single package `"."`, `include-v-in-tag: true`,
`bump-minor-pre-major: true`. Manifest: `{".": "1.0.1"}`.

> **`simple` is not a shortcut — `rust` throws here.** release-please's Rust
> updater hard-errors "is not a package manifest (might be a cargo
> workspace)" on any manifest with no `[package]` section, and the root
> `Cargo.toml` is a pure virtual workspace.

`extra-files`, all `"type": "generic"` and driven by
`# x-release-please-version` markers: `Cargo.toml`,
`charts/vym-fyi-server-crud/Chart.yaml`,
`charts/vym-fyi-server-redirect/Chart.yaml` — the charts' **`appVersion`**
only.

Two mechanisms in `release-please.yml` are load-bearing and commented as such:

1. **A GitHub App token, not `GITHUB_TOKEN`.** GitHub raises no workflow
   events for anything done with the default token, so with it the `vX.Y.Z`
   tag would trigger **none** of `Release Client`, `Build Docker image` or
   `Helm Publish` — a release that looks cut and published nothing, with
   nothing failing to say so.
2. **`skip-github-release: true`**, because an App-token tag _does_ reach the
   tag-triggered workflows, and release-please creating the Release itself
   would race them for the same tag.

After a release PR is created or updated, the workflow checks the branch out
and runs `cargo metadata` in every directory containing a `Cargo.lock`,
committing the refresh — because the Dockerfile builds `--locked` and a stale
lockfile is red at image-build time even though `cargo test` never noticed.

## `deny.toml`

Licences allowed: `Zlib`, `ISC`, `Unicode-3.0`, `MIT`, `Apache-2.0`,
`EUPL-1.2`, `BSD-3-Clause`, `GPL-3.0`, `CDLA-Permissive-2.0`.
`unused-allowed-license = "warn"`, confidence `0.95`.

**No `[advisories] ignore` entries**, and the file says so with a date. The
one that used to be there — RUSTSEC-2023-0071, the Marvin Attack on `rsa` —
was **removed rather than renewed**, because `rsa` is not reachable: it
enters `Cargo.lock` only through `sqlx-mysql`'s optional dependency and this
workspace never enables `sqlx`'s `mysql` feature.

The comment's closing instruction is the part worth carrying: if `rsa` ever
becomes reachable, **write a fresh reachability argument** — does the new
caller _decrypt_, the operation the timing side-channel actually needs, or
only sign and verify? — rather than reinstating the old ignore blind. It
points at the sibling `vsms` repository's `deny.toml` for a worked example.
