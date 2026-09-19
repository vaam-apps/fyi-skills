---
name: fyi
description: "Orientation for working in vym.fyi (the vaam-apps/fyi repository) — a tiny, API-only, multi-tenant URL shortener in Rust with two services, six crates and deliberately no web UI. Load this before any task in the repo: it carries the workspace layout, the named patterns the codebase applies on purpose, the destructive boot-time tenant sync, the standing warning that this repo's own docs disagree with its code in several places, and which of the other fyi-* skills to load."
---

# fyi

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true — a feature on `main` may be absent
> from the tree you are editing. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

`vym.fyi` is a multi-tenant URL shortener. **There is intentionally no
dashboard** — an HTTP API and a CLI, nothing else — so the footprint stays
tiny and nothing is spent hosting or rendering UI.

Two services share one Postgres database through **different roles**:

| Service                   | Role       | Env               | Does                                                                             |
| ------------------------- | ---------- | ----------------- | -------------------------------------------------------------------------------- |
| `vym-fyi-server-crud`     | read/write | `DATABASE_URL`    | Creates and lists links. API-key auth. Runs migrations and syncs tenants at boot |
| `vym-fyi-server-redirect` | read-only  | `DATABASE_URL_RO` | Resolves `/{slug}` and redirects. No auth of any kind                            |

## Read this first: the docs and the code disagree in several places

fyi's `docs/` and `AGENTS.md` were written with care, and several of their
claims are nevertheless **not true of the code** — including how many crates
exist, what the CRUD API can actually do, and which status the redirect
returns.

**Load [`fyi-docs-drift`](../fyi-docs-drift/) before trusting any prose in
this repository, including `docs/arc42.md`.** It is a short, enumerated list
with the file and line behind each item. This is the single highest-value
thing to know here, which is why it gets its own skill rather than a footnote.

Corollary for your own work: **open the `.rs` file.** A claim you can only
source to `docs/` is not verified.

## The workspace — six crates, not five

Edition 2024, `resolver = "3"`. Shared dependencies are pinned in the root
`[workspace.dependencies]`; a custom `prod` profile (`lto = true`,
`opt-level = "z"`, `codegen-units = 1`, `strip = true`) builds the release
containers.

| Crate                     | What it is                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vym-fyi-model`           | The shared core. Repositories, config loading, slug generation, the HTTP-client singleton, Axum metrics, static assets, `AppError`, domain models |
| `vym-fyi-server-crud`     | The write API. Owns `migrations/`, API-key auth, link handlers                                                                                    |
| `vym-fyi-server-redirect` | The read path                                                                                                                                     |
| `vym-fyi-client`          | Clap CLI over the CRUD API                                                                                                                        |
| `vym-fyi-node`            | N-API v3 `cdylib` — `ping`/`create_link`/`list_links` for Node.js                                                                                 |
| `vym-fyi-healthcheck`     | **Zero-dependency** static binary; raw TCP `GET /health` for the container `HEALTHCHECK`                                                          |

Only four have a README, and **three of those four are one-line stubs** (`# CRUD`,
`# Redirect`, `# Client`). `vym-fyi-model`'s is real but covers only logging
and the HTTP client. `vym-fyi-node` and `vym-fyi-healthcheck` have none at
all. Do not read an absent README as an absent component.

## Commands

```bash
cargo check --all-targets --all-features
cargo test --workspace --all-targets        # needs NO Postgres — see below
cargo clippy --all-targets --all-features -- -D warnings   # CI gates on this
cargo fmt --all
cargo llvm-cov --workspace --all-features --fail-under-lines 70

DATABASE_URL=postgres://… TENANTS_CONFIG_PATH=.docker/tenants.yaml cargo run -p vym-fyi-server-crud
DATABASE_URL_RO=postgres://… cargo run -p vym-fyi-server-redirect
cargo run -p vym-fyi-client -- --config config.yaml --client client-a ping

docker compose up --build   # Postgres, both services, Prometheus, Grafana
```

**`cargo test` needs no database, and that is a coverage statement as much as a
convenience.** There is no `sqlx::test` anywhere in the workspace. Every test
is a unit test over config resolution, the two link-creation strategies
against an in-memory stub, the query adapter and the HTTP-client singleton.
`sqlx` uses runtime-checked `sqlx::query(...).bind(...)`, never the
compile-time `query!` macros, so no `DATABASE_URL` is needed at build time
either — and nothing checks a query against a real schema at any point.

## The patterns are deliberate — preserve them

The codebase applies a small, named set on purpose:

- **Facade + Builder** — `CrudApp`/`CrudAppBuilder`, `RedirectApp`/`RedirectAppBuilder`.
  The app struct is the Axum router `State` and is `Clone`. `build()` is where
  the pool is created and, for CRUD, migrations run and tenants sync.
- **Abstract Factory** — `RepositoryFactory` + `PgRepositoryFactory` hand out
  `TenantRepository`/`ShortLinkRepository`. Apps hold `Arc<dyn RepositoryFactory>`.
- **Strategy** — `ProvidedSlugStrategy` (upsert) vs `GeneratedSlugStrategy`
  (random with retry), chosen by whether the request supplies a slug. The
  handler defines a **local** `LinkRepository` trait so the strategies can be
  unit-tested against a stub.
- **Adapter** — `LinkListQueryAdapter` + `QueryParamsBuilder` turn list filters
  into HTTP query params in one place.
- **Singleton** — `HttpClient::global()`, a `once_cell::Lazy` `reqwest` client
  with tuned pools and timeouts. **Do not build ad-hoc clients.**

## The trap that will bite hardest

> **The CRUD server DELETES tenant rows on every boot.**

`sync_tenants_with_repo` creates a tenant for every client id in the config
file, and **deletes every tenant row whose name is not in that file**.
`api_keys.tenant_id` is `ON DELETE CASCADE`, so the tenant's keys go with it.
There is no soft delete, no dry run, no confirmation. Removing or renaming a
client entry and restarting is a destructive operation.

`short_links.tenant_id` has **no** `ON DELETE` clause, so a tenant that still
has links will instead make the delete **fail** the foreign-key constraint,
and nothing in the code handles that. See `fyi-auth-tenancy`.

## Other things worth knowing before you start

- **`TENANTS_CONFIG_PATH` unset is not an error.** The server logs a warning,
  builds an **empty** API-key store, and starts — effectively locked down. It
  looks healthy and rejects everything.
- **Both binaries use mimalloc** as the global allocator and bind via
  `bind_addr_from_env` (`ADDRESS`, `PORT`, default `8000`).
- **`AGENTS.md` is a symlink to `CLAUDE.md`** (git mode `120000`). Edit
  `CLAUDE.md`; never replace the symlink with a regular file.
- **Static 404/500 pages are read from `./static` relative to the process
  working directory**, at request time, with a hardcoded string fallback if
  the file is missing. A container that does not `COPY static/` serves the
  fallback silently.

## Which skill to load

| The work                                                     | Load               |
| ------------------------------------------------------------ | ------------------ |
| **Anything, before trusting a documented claim**             | `fyi-docs-drift`   |
| The write API — routes, link creation, listing, status codes | `fyi-crud-api`     |
| The redirect hot path, its status code, its metrics          | `fyi-redirect`     |
| API keys, the master key, the config file, the tenant sync   | `fyi-auth-tenancy` |
| The schema, repositories, slug generation, `AppError`        | `fyi-data`         |
| The CLI, the Node binding, the shared HTTP client            | `fyi-clients`      |
| Docker, Helm, compose, metrics, health, static assets        | `fyi-ops`          |
| CI, release-please, cargo-deny, commit messages              | `fyi-tooling`      |
