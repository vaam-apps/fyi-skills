---
name: fyi-redirect
description: "The vym.fyi read path — the exact redirect status (307, not the 302 the architecture doc claims), the single query behind every request and the absence of any cache, the per-slug metrics and their cardinality bucketing, and what an unknown, inactive or expired slug returns. Load before touching the redirect handler, reasoning about its latency, or writing anything that depends on the redirect status or its caching headers."
---

# fyi-redirect

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

`vym-fyi-server-redirect`. Read-only — it connects with `DATABASE_URL_RO` and
is meant to be given a read-only Postgres role. Its routes:

| Route                               | Auth     | Notes                                 |
| ----------------------------------- | -------- | ------------------------------------- |
| `GET /{slug}`                       | **none** | The whole product                     |
| `GET /health`                       | none     | `200 {"status":"OK"}`, checks nothing |
| `GET /static/*`, `GET /favicon.ico` | none     | Shared with the CRUD server           |
| `GET /metrics`                      | none     | Prometheus text                       |

`/{slug}` is a catch-all at the root, so **any** unmatched single-segment path
is a slug lookup.

## The status is `307`

```rust
Redirect::temporary(&target)   // handlers/short_link.rs
```

axum's `Redirect::temporary` is `StatusCode::TEMPORARY_REDIRECT` = **`307`**.

> ~~`docs/arc42.md` §6.1: "Returns an HTTP redirect (e.g. `302`)".~~
> **Wrong as of `2ed14f8c`.** It is `307`, and the difference matters: `302`
> historically permits a client to turn a `POST` into a `GET`; `307` preserves
> the method. Any test, CDN rule or integration asserting on the status needs
> `307`.

A successful redirect also carries **`Cache-Control: public, max-age=60`**,
which no document mentions. That is a real operational fact: a changed target
can be served stale by an intermediary for up to a minute.

## One query, no cache

```sql
SELECT target_url FROM short_links
WHERE slug = $1 AND is_active = TRUE
  AND (expires_at IS NULL OR expires_at > NOW())
```

That is the entire hot path. **There is no cache** — not in-process, not
Redis, nothing. Every request is one round trip to Postgres.
`docs/README.md`'s roadmap lists "optional in-memory cache for hot slugs"
under _3–6 months_; read it as absent.

Expiry and deactivation are enforced **here, in the query**, not by a
background job. Nothing ever deletes an expired row.

Note also what the query does **not** do: it does not filter by tenant.
`slug` is the `short_links` primary key, so slugs are globally unique across
tenants by construction — the redirect side has no notion of tenancy at all.

## The three outcomes

| Case                          | Status | Body                  | `Cache-Control`      |
| ----------------------------- | ------ | --------------------- | -------------------- |
| Resolved                      | `307`  | empty, `Location` set | `public, max-age=60` |
| Unknown, inactive, or expired | `404`  | `static/404.html`     | **`no-store`**       |
| Database error                | `500`  | `static/500.html`     | **`no-store`**       |

The two error bodies come from `vym_fyi_model::services::static_assets`, read
from `./static/` **relative to the process working directory at request
time**. If the file is missing or unreadable, the handler silently substitutes
a hardcoded string (`"404 – Not Found"`, `"500 – Internal Server Error"`) and
still returns the right status. A container that forgets to `COPY static/`
therefore serves plain text and nothing reports a problem.

Only the database-error case logs; a `404` logs at `debug!`.

## Metrics, and the cardinality guard

Before doing anything else, the handler increments
`redirect_slug_requests_total` with **two** labels:

- `slug` — the raw slug value;
- `slug_len` — bucketed by `bucket_slug_len`: `len_0`, `len_1_4`, `len_5_8`,
  `len_9_12`, `len_13_20`, `len_over_20`.

**The bucketing bounds `slug_len`, not `slug`.** `slug` is unbounded-cardinality
by design — it is what makes "top slugs by traffic" possible, and it is
exactly what will hurt a Prometheus instance facing a scan of random paths.
This route is unauthenticated and catch-all, so **every 404-generating probe
mints a new time series**. Know that before pointing this at the open
internet, and note that `AGENTS.md`'s summary ("Redirect buckets slug-length
labels to bound cardinality") is true about `slug_len` and easy to misread as
a claim about `slug`.

On top of that, every request also goes through the shared
`record_ip_metrics` middleware and the `axum-prometheus` layer — see
`fyi-ops`.

## No tests

`crates/vym-fyi-server-redirect/src` contains **no tests at all**. Not the
handler, not the bucketing function, not the app builder. If you change
anything here, there is nothing to catch you.
