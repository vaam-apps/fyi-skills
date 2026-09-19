---
name: fyi-data
description: "vym.fyi's persistence — the three-table schema and the indexes it does not have, the repository layer and the exact SQL behind each method, runtime-checked sqlx (no compile-time query macros, so no query is ever checked against a real schema), slug generation and its even-length surprise, and AppError's near-total absence of HTTP status mapping. Load before writing a query, adding a migration, changing an error variant, or reasoning about what a failure looks like to a caller."
---

# fyi-data

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

## The schema

One migration, `crates/vym-fyi-server-crud/migrations/20250101000000_init.sql`,
embedded with `sqlx::migrate!()` and run automatically by
`CrudAppBuilder::build()`.

```sql
tenants (
  id uuid PRIMARY KEY, name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now())

api_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, key_hash text NOT NULL, role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz)

short_links (
  slug text PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),        -- nullable, NO on-delete clause
  target_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_api_key_id uuid REFERENCES api_keys(id),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true)
```

Four things to notice, each of which has a consequence elsewhere:

1. **`tenants.name` has no unique constraint**, yet the tenant sync and
   `delete_by_name` both key on it. Two rows with the same name are possible
   and would make the sync's behaviour depend on row order.
2. **`short_links.tenant_id` has no `ON DELETE` clause** — default
   `NO ACTION`. Deleting a tenant that still owns links **fails**. See
   `fyi-auth-tenancy`.
3. **There is not a single `CREATE INDEX`.** The only indexes are the three
   implicit primary keys. `list_by_tenant` filters on `tenant_id` and orders
   by `created_at DESC` with no index supporting either.
4. **`api_keys` is written by nothing and read by nothing.** Auth comes from
   the config file. `key_hash` and `revoked_at` are inert columns, and
   `created_by_api_key_id` on `short_links` is never populated.

## The repository layer

`crates/vym-fyi-model/src/services/repos.rs`. `RepositoryFactory` (trait) +
`PgRepositoryFactory` hand out two repositories; apps hold
`Arc<dyn RepositoryFactory>`.

**Every query is runtime `sqlx::query(...).bind(...)` with manual
`row.get(...)`.** There is no `query!`/`query_as!` anywhere in the workspace.
Two consequences worth stating plainly:

- **No `DATABASE_URL` is needed at build time** — convenient, and the reason
  CI needs no database.
- **No query is ever checked against a real schema, at build time or in a
  test.** A column rename compiles, passes CI, and fails at runtime. There is
  no `sqlx::test` in the workspace either.

| Method                                            | SQL                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TenantRepository::list_all`                      | `SELECT id, name FROM tenants`                                                                         |
| `TenantRepository::create`                        | `INSERT INTO tenants (id, name, status) VALUES ($1, $2, 'active')` with a fresh `Uuid::new_v4()`       |
| `TenantRepository::delete_by_name`                | `DELETE FROM tenants WHERE name = $1`                                                                  |
| `ShortLinkRepository::upsert`                     | `INSERT … ON CONFLICT (slug) DO UPDATE … WHERE short_links.tenant_id = EXCLUDED.tenant_id RETURNING …` |
| `ShortLinkRepository::create_with_generated_slug` | the same insert with `DO NOTHING`, in a 5-attempt loop                                                 |
| `ShortLinkRepository::list_by_tenant`             | `… WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`                                   |
| `ShortLinkRepository::list_paginated`             | the same without the tenant filter                                                                     |
| `ShortLinkRepository::resolve`                    | `… WHERE slug = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())`                |

`upsert`'s conflict `WHERE` is the multi-tenancy control; a suppressed update
surfaces as `AppError::Conflict("slug already exists for a different
tenant")`. See `fyi-crud-api`.

Note `list_paginated` exists and **nothing calls it** — `GET /api/links`
builds its own `QueryBuilder` query instead, because it needs the optional
filters.

## Slug generation

```rust
pub fn generate_slug(min_len: usize) -> String   // services/slug.rs
```

- The alphabet is **lowercase hex**, `0-9a-f` — each random byte formatted
  `{:02x}`. Not base62, not URL-safe-base64.
- `min_len` is clamped up to at least **6**.
- **The output length is always even.** It allocates
  `min_len.div_ceil(2)` bytes and emits two hex characters each, so asking for
  7 gives you **8**. Asking for 6 gives 6.
- Randomness is `rand::rng().fill(...)` — the thread-local RNG.
- **No collision handling lives here.** That is the repository's 5-attempt
  loop.

At 6 characters the space is 24 bits — about 16.7 million. Five attempts is
generous early and thin later; the exhaustion path is documented in
`fyi-crud-api` and returns a misleading `500`.

## `AppError` barely maps to HTTP at all

`crates/vym-fyi-model/src/models/errors.rs` — a `thiserror` enum with
`Io`, `Http`, `CliError`, `YamlError`, `Sqlx`, `SqlxMigrate`,
`SetGlobalDefaultError`, `Server`, `Conflict`, `CrlFfi`, `MissingEnvVar`,
`Config`; plus `AppResult<T>`.

> **There is no `impl IntoResponse for AppError` anywhere in the workspace.**
> `AGENTS.md` says "Axum handlers map `AppError` to `StatusCode` (e.g.
> `Conflict` → 409, missing tenant → 403)". The reality is narrower: **one
> hand-written `match`** in `handlers/links.rs`'s `create_link`, which turns
> `AppError::Conflict` into `409` and **everything else into `500`**. The
> `403`s are raw `StatusCode` returns from the auth extractor and the
> handlers, not derived from `AppError` at all.

That is why generated-slug exhaustion — which returns `AppError::Config` —
comes out as a `500`. **If you add a variant expecting it to carry a status,
it will not.** Either extend that match or add a real `IntoResponse`.

`AppError::CrlFfi` is declared and **never constructed anywhere**. Treat it as
vestigial.

## The shared HTTP client

`HttpClient::global()` — a `once_cell::Lazy` singleton (`services/http_client.rs`)
used by the CLI and the Node binding:

| Setting                   | Value |
| ------------------------- | ----- |
| `connect_timeout`         | 5s    |
| `timeout` (whole request) | 30s   |
| `pool_idle_timeout`       | 90s   |
| `pool_max_idle_per_host`  | 16    |
| `tcp_keepalive`           | 60s   |

Helpers: `fetch_json`, `post_json`, `post_json_auth` (bearer). A unit test
asserts singleton identity via `std::ptr::eq`. **Do not construct ad-hoc
`reqwest` clients.**

## Adding a migration

New files go in `crates/vym-fyi-server-crud/migrations/`. They run
automatically at CRUD startup. Since nothing checks a query against the
schema, **a migration and the query that uses it must be changed together and
verified by hand against a real database** — CI will not catch a mismatch.
