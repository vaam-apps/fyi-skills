---
name: fyi-crud-api
description: "The vym.fyi write API — the five routes it actually serves (and the tenant/API-key endpoints the docs claim but it does not have), the two link-creation strategies and their different failure modes, list filtering and pagination, and the exact status code every path returns. Load before calling, testing, extending or documenting POST or GET /api/links, or before believing a documented CRUD capability."
---

# fyi-crud-api

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

## The complete route table

`crates/vym-fyi-server-crud/src/main.rs`. This is all of it:

| Route              | Auth     | Success                                           |
| ------------------ | -------- | ------------------------------------------------- |
| `GET /health`      | none     | `200`, `{"status":"OK"}`                          |
| `POST /api/links`  | **yes**  | **`201 Created`**                                 |
| `GET /api/links`   | **yes**  | `200`, a **bare JSON array**                      |
| `GET /static/*`    | none     | served from `./static` relative to CWD            |
| `GET /favicon.ico` | none     | `308` permanent redirect to `/static/favicon.ico` |
| `GET /metrics`     | **none** | Prometheus text                                   |

> **There is no endpoint for tenants or API keys**, despite `docs/arc42.md`
> and `docs/README.md` both describing this as an API "for managing tenants,
> API keys, and short links". Tenants come from the YAML config at boot; API
> keys live only in that file. See [`fyi-docs-drift`](../fyi-docs-drift/) and
> [`fyi-auth-tenancy`](../fyi-auth-tenancy/).

> **`/metrics` is unauthenticated.** So is `/health`. If either matters to you,
> it is a network-layer problem — nothing in the code gates them.

## `POST /api/links`

Body: `{"slug": "optional", "target_url": "required"}`.

The handler picks a strategy by whether `slug`, **trimmed**, is present and
non-empty:

### `ProvidedSlugStrategy` — upsert, with a tenant guard

One statement:

```sql
INSERT INTO short_links (slug, target_url, is_active, tenant_id)
VALUES ($1, $2, TRUE, $3)
ON CONFLICT (slug) DO UPDATE
    SET target_url = EXCLUDED.target_url, is_active = TRUE
    WHERE short_links.tenant_id = EXCLUDED.tenant_id
RETURNING slug, target_url, is_active
```

The `WHERE` on the conflict branch is the multi-tenancy control: if the slug
already exists **under a different tenant**, the update is suppressed,
`fetch_optional` returns `None`, and the repository returns
`AppError::Conflict("slug already exists for a different tenant")` → **`409`**.

Within your own tenant this is a silent overwrite, not an error. `POST`ing an
existing slug **retargets it**.

### `GeneratedSlugStrategy` — five attempts, then a misleading 500

Called with a hardcoded `min_len` of `6`. Loops at most **`MAX_ATTEMPTS = 5`**,
each iteration generating a fresh slug and attempting
`INSERT … ON CONFLICT (slug) DO NOTHING RETURNING …`.

> **When all five collide, it returns `AppError::Config(...)`, not
> `AppError::Conflict(...)`** — so `create_link`'s error match falls into its
> catch-all arm and the caller gets **`500 Internal Server Error`** for what is
> really a collision-exhaustion condition. A client cannot distinguish it from
> a database outage, and retrying (which would probably succeed) is not the
> obvious response to a `500`. Worth knowing before you diagnose one; worth
> fixing if you are touching that path anyway.

### Status codes out of `POST /api/links`

| Status | When                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| `201`  | Created or retargeted                                                             |
| `401`  | No API key in any accepted header                                                 |
| `403`  | Key present but matched nothing; or authenticated non-master with no bound tenant |
| `409`  | `AppError::Conflict` — slug owned by another tenant                               |
| `500`  | Everything else, **including generated-slug exhaustion**                          |

## `GET /api/links`

Query parameters, all optional: `page`, `per_page`, `slug`,
`target_contains`, `active`, `created_before`, `created_after`,
`expires_before`, `expires_after`.

- **`page` defaults to `1`** and is floored at 1.
- **`per_page` defaults to `20` and is clamped to `[1, 100]`.** A request for
  1000 silently gets 100.
- The four timestamp filters are **RFC3339 strings**, parsed with
  `DateTime::parse_from_rfc3339`; anything unparseable is **`400`**.
- `slug` is an exact match (trimmed, ignored when empty);
  `target_contains` is a case-insensitive `ILIKE '%…%'`.
- Ordering is always `created_at DESC`.

**Tenant scoping**: a master caller gets `WHERE TRUE` — **every tenant's
links**. A non-master is scoped to its bound `tenant_id`, or `403` if it has
none.

**The response is a bare array**, not an envelope:

```json
[{ "slug": "…", "target_url": "…", "active": true }]
```

**There is no total count and no next-page token.** A client cannot tell a
full last page from a partial one except by requesting the next page and
getting an empty array.

The query is assembled with `sqlx::QueryBuilder` and every value is bound, not
interpolated.

## What is not here

- **No update or delete route.** A link is retargeted by re-`POST`ing its
  slug; `is_active` and `expires_at` exist in the schema and in the resolve
  query but **nothing in the API can set them** after creation.
- **No rate limiting**, per-tenant or global.
- **No audit log.** `short_links.created_by_api_key_id` exists in the schema
  and is never written.

## Tests

`crates/vym-fyi-server-crud/src/handlers/links.rs` has the crate's only tests:
two, over a `StubRepo` implementing the handler's **local** `LinkRepository`
trait. `provided_slug_strategy_uses_upsert` and
`generated_slug_strategy_requests_generation` each assert the right repository
method was called exactly once and the other not at all.

That is genuinely all the coverage this crate has. The routes themselves, the
auth extractor, the query builder, the status mapping and the tenant scoping
are **untested**, and no test in the workspace touches Postgres.
