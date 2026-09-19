---
name: fyi-docs-drift
description: "The enumerated list of places where vym.fyi's own documentation disagrees with vym.fyi's code — a CRUD API that does not manage what arc42 says it manages, a redirect status the docs get wrong, a crate the architecture document omits entirely, and a stale doc comment. Load this before quoting or acting on any claim sourced to docs/, AGENTS.md, CLAUDE.md or a crate README, and add to it whenever you find another."
---

# fyi-docs-drift

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

fyi's documentation is good in intent and thorough in places — `docs/README.md`
in particular is a genuinely useful developer guide. It is also wrong about
several things an agent would act on. **This page is the running list.**

Each item below was checked against the source, not inferred from a second
document. Where a claim is correct, it is listed too, because "this reads like
drift and is not" is worth as much as the drift itself.

## 1. The CRUD API does not manage tenants or API keys

`docs/arc42.md` (§1.1, §3) and `docs/README.md` both describe
`vym-fyi-server-crud` as a "CRUD/API server for **tenants, API keys**, and
short links".

**It serves five routes and none of them touch tenants or API keys**
(`crates/vym-fyi-server-crud/src/main.rs`):

```text
GET  /health
POST /api/links
GET  /api/links
GET  /static/*      (+ GET /favicon.ico)
GET  /metrics
```

There is no `POST /api/tenants`, no key-issuing endpoint, nothing. Tenants are
managed **only** by the boot-time sync from the YAML config file, and API keys
exist **only** in that file — the `api_keys` table is created by the migration
and never read by the auth path.

**Consequence for an agent:** a task phrased as "add a tenant through the API"
has no endpoint to call. The answer is to edit the config file and restart —
with the destructive semantics `fyi-auth-tenancy` describes.

## 2. The redirect is `307`, not `302`

`docs/arc42.md` §6.1 says the redirector "returns an HTTP redirect (e.g.
`302`)".

`crates/vym-fyi-server-redirect/src/handlers/short_link.rs` calls
`Redirect::temporary(&target)`, and axum's `Redirect::temporary` is
`StatusCode::TEMPORARY_REDIRECT` — **`307`**. The difference is not cosmetic:
`302` historically permits a client to rewrite a `POST` into a `GET`, while
`307` preserves the method. Anything asserting on the status — a test, a CDN
rule, an integration — needs `307`.

The response also carries `Cache-Control: public, max-age=60`, which neither
document mentions.

## 3. `docs/arc42.md` omits a crate entirely

Its system list (§1) and workspace inventory (§5.1) name five crates. The root
`Cargo.toml` has **six** workspace members: `vym-fyi-node`, the N-API `cdylib`
binding for Node.js, is missing from both lists.

`docs/README.md` omits it as well.

## 4. The arc42 CLI example does not parse

§6.2 shows:

```text
vym-fyi-client links create --client client-a --slug abc123 --target https://example.com
```

The subcommand is **`links-create`**, one hyphenated token — `Command::LinksCreate`
in `crates/vym-fyi-client/src/shared/cli.rs`. `links create` is two arguments
and clap will reject it. `--client` is also a **global** option that precedes
the subcommand, not a flag on it.

`docs/README.md`'s own walkthrough gets this right, in the same repository.
Prefer it.

## 5. A doc comment says the handler does not persist

`crates/vym-fyi-server-crud/src/handlers/links.rs` carries
`/// Create a short link (skeleton, no persistence yet).` directly above
`create_link`, which persists through the strategy and the repository. The
comment is left over from an earlier shape.

`crates/vym-fyi-server-redirect/src/handlers/short_link.rs`'s
`/// Redirect endpoint skeleton.` is in the same category, though its second
paragraph — "slugs are assumed to be globally unique" — is an accurate and
useful statement of a real design assumption (`slug` is the `short_links`
primary key).

## 6. `docs/README.md`'s roadmap reads as capability

It lists, under dated headings, per-tenant rate limits, audit logs, read
replicas, an in-memory hot-slug cache, graceful degradation when Postgres is
unavailable, soft delete with TTL, per-tenant quotas, link labels and an
analytics surface.

**None of these exist.** They are a roadmap, correctly labelled as one, but an
agent skimming for capability will read them as features. Specifically:

- **There is no cache of any kind on the redirect path** — every request is one
  direct `SELECT`.
- **There is no rate limiting** anywhere in either service.
- **There is no graceful degradation**: a database error is a `500` rendered
  from `static/500.html`.

## 7. Correct, despite looking like drift

Listed so nobody "fixes" them:

- **`AGENTS.md` really is a symlink to `CLAUDE.md`** (git mode `120000`), as
  its own closing line claims. The two files having identical content is the
  symlink working, not duplication.
- **The auth header description is exact.** `X-API-Key`, falling back to
  `Authorization: ApiKey <key>` with that literal scheme word, plus
  `X-Client-Id` — matching `crates/vym-fyi-server-crud/src/auth.rs`.
- **The `$(ENV_VAR)` placeholder description is exact**, including that a
  missing variable is a hard error.
- **The Docker and Helm descriptions are exact**: three build targets
  (`crud`, `redirect`, `healthcheck`), musl static, distroless nonroot, one
  chart per server.
- **`docs/README.md`'s CLI walkthrough is exact**, including every
  `links-list` filter flag and its query-parameter mapping.

## How to add to this page

Drift here is not a one-off. When you find another instance:

1. Quote the document's claim and cite the file.
2. Cite the source file and line that contradicts it.
3. Say what an agent would do wrong if it believed the document.
4. Fix the document in the fyi repository too, if you can — this page exists
   because the drift is real, not so that it can be preserved.
