# Changelog

Per release: the fyi range covered, which skills changed, and — most
importantly — **any claim that stopped being true**, which is the entry someone
upgrading actually needs.

## v2026-09-19-2ed14f8c — initial release

Verified against fyi
[`2ed14f8c`](https://github.com/vaam-apps/fyi/commit/2ed14f8c04032deb38b02006038ce834db36f9c0)
(2026-09-19).

Nine skills: orientation, the documentation-drift list, the CRUD API, the
redirect path, auth and tenancy, the data layer, the clients, operations, and
tooling.

**No claims retired**, there being no previous release.

### The drift list is the point of this release

`fyi-docs-drift` exists because fyi's own documentation disagrees with its code
in six enumerated places, each checked against the source rather than inferred:
the CRUD API does not manage tenants or API keys; the redirect returns `307`,
not the `302` `docs/arc42.md` states; `docs/arc42.md` omits `vym-fyi-node`
entirely; its CLI example (`links create`) does not parse against the real
subcommand (`links-create`); a doc comment still says a handler does not
persist; and `docs/README.md`'s roadmap reads as capability.

**If any of those are fixed upstream, the corresponding item here must be
struck through and dated, not deleted** — a reader on an older fyi still needs
to know the document was wrong for them.

### The claims most likely to go stale first

- **The redirect status.** One `Redirect::temporary` call. A one-line change
  flips it, and integrations depend on it.
- **Route tables.** Five routes on CRUD, four on redirect. Any new endpoint
  makes `fyi-crud-api`'s "this is all of it" false.
- **Constants**: `MAX_ATTEMPTS = 5`, `min_len` clamped to 6, `per_page` default
  20 / max 100, the healthcheck's `3000` default port, chart `version: 1.0.0`
  / `appVersion: 1.0.1`, `app-template` `4.0.1`.
- **"Not built" claims** — no cache, no rate limiting, no update/delete route,
  no key rotation, no audit log, no hashing of API keys, no `IntoResponse` for
  `AppError`, `list_paginated` uncalled, `AppError::CrlFfi` never constructed,
  `role` parsed but never branched on. Each becomes wrong the moment it is
  built.
- **Test coverage claims.** "No test touches Postgres", "the redirect crate has
  no tests at all". Both are true at this commit and both are one PR from
  false — and they are the claims most likely to be quoted as a reason not to
  trust a green run.
- **The `advisories` leg of `cargo-deny` is non-gating** (`continue-on-error`).
- **`deny.toml` has no ignore entries.**

### Two security-adjacent statements worth re-checking every release

Both are accurate at `2ed14f8c` and both are the kind of thing that changes
quietly:

1. **API keys are compared in plaintext**, with a hand-rolled inline
   `constant_time_eq` in `crates/vym-fyi-server-crud/src/app.rs` — not
   `subtle`, not the `constant_time_eq` crate, neither of which is a
   dependency. The `key_hash` column exists and nothing writes or reads it.
2. **The `client_ip` metric label trusts `X-Forwarded-For` unconditionally**,
   and the redirect service's `slug` label is unbounded-cardinality on an
   unauthenticated catch-all route.

### Notes on this repository's own gate

`tools/verify-coverage.mjs` is adapted from `vaam-apps/vpay-skills` and
`vaam-apps/vsms-skills`. Four things differ, each commented at the point of
divergence in the file:

- **The sentinel is not `AGENTS.md`**, even though fyi has one — it is a
  symlink to `CLAUDE.md` (git mode `120000`), so a checkout that did not
  materialise the symlink makes `existsSync` false on a file git considers
  present; and a bare `AGENTS.md` test identifies nothing. The gate checks for
  a `Cargo.toml` naming `crates/vym-fyi-model` as a workspace member.
- **There is no `docs/flows/`.** vpay's gate walks a feature index that, per
  vsms-skills' own changelog, never existed there either. fyi's `docs/` is
  three pages, which is not a feature index. The three surfaces walked are
  real: `docs/**/*.md`, `crates/**` (manifests **and** READMEs), and
  `charts/*/Chart.yaml`.
- **The crate surface keys on the manifest, not the README**, because
  `vym-fyi-healthcheck` and `vym-fyi-node` have none — the exact components a
  README-keyed surface would render invisible.
- **`ancestors()` is generalised.** vsms hardcodes
  `backends/crates|apps/<name>`. Here a directory claim is valid for any
  directory strictly below a surface root, so `crates/vym-fyi-model` is a claim
  and bare `crates` is not.

The gate was proven to fail before it was trusted, three ways: adding a seventh
crate named it; adding a file under an already-claimed crate directory named it
as post-baseline; and replacing a crate-level claim with a bare `crates` claim
named both of that crate's files as uncovered — confirming a surface-root claim
is not a claim.
