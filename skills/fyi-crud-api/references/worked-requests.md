# Worked requests

Every call the CRUD API accepts, with real headers. Assumes a client id of
`client-a` whose key resolved to `client-a-key`, and the default port `8000`.

## Headers, every time

```
X-API-Key: client-a-key
X-Client-Id: client-a
```

Or, equivalently for the key:

```
Authorization: ApiKey client-a-key
```

**The scheme word is `ApiKey`, not `Bearer`**, and `X-Client-Id` is still
required alongside it for a non-master key. A master key is accepted with any
`X-Client-Id`, or none.

## `POST /api/links` — with a chosen slug

```bash
curl -sS -X POST http://localhost:8000/api/links \
  -H 'X-API-Key: client-a-key' \
  -H 'X-Client-Id: client-a' \
  -H 'Content-Type: application/json' \
  -d '{"slug":"promo-2025","target_url":"https://example.com/landing"}'
```

`201` with `{"slug":"promo-2025","target_url":"…","active":true}`.

**Re-posting an existing slug you own retargets it silently** — an upsert, not
an error. Posting a slug owned by **another** tenant is `409`.

## `POST /api/links` — server-generated slug

```bash
curl -sS -X POST http://localhost:8000/api/links \
  -H 'X-API-Key: client-a-key' -H 'X-Client-Id: client-a' \
  -H 'Content-Type: application/json' \
  -d '{"target_url":"https://example.com/landing"}'
```

The slug comes back in the response. It is **lowercase hex**, six characters
(`min_len` is hardcoded to 6 here and the generator's output length is always
even). Five collision retries; exhausting them returns a **`500`**, not a
`409` — see the parent skill.

## `GET /api/links`

```bash
curl -sS 'http://localhost:8000/api/links?page=1&per_page=50&active=true' \
  -H 'X-API-Key: client-a-key' -H 'X-Client-Id: client-a'
```

```bash
curl -sS -G http://localhost:8000/api/links \
  -H 'X-API-Key: client-a-key' -H 'X-Client-Id: client-a' \
  --data-urlencode 'target_contains=landing' \
  --data-urlencode 'created_after=2025-01-01T00:00:00Z' \
  --data-urlencode 'created_before=2025-12-31T23:59:59Z'
```

`200` with a **bare array**. No `total`, no cursor — a full page and a last
page look identical, so detecting the end means asking for the next one.

`per_page` is clamped to `[1, 100]`; asking for 1000 gets 100 with no
indication. The timestamp filters are RFC3339 and anything unparseable is a
`400`.

## `GET /health`

```bash
curl -sS http://localhost:8000/health
```

`200 {"status":"OK"}`, **unauthenticated**, and it checks nothing — not the
database, not anything. A `200` here says the process is up and says nothing
about whether it can serve a request. The CLI's `ping` hits this endpoint, so
**a successful `ping` does not validate your API key**; use `links-list` for
that.

## `GET /metrics`

```bash
curl -sS http://localhost:8000/metrics
```

Prometheus text, **unauthenticated**. Gate it at the network layer if that
matters; nothing in the code does.

## Reading a failure

| Status | Most likely cause                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`  | Neither `X-API-Key` nor `Authorization: ApiKey …` was sent                                                                                    |
| `403`  | Key sent but matched nothing — or the right key with the wrong or missing `X-Client-Id`; or an authenticated caller whose tenant is not bound |
| `400`  | An unparseable RFC3339 timestamp filter                                                                                                       |
| `409`  | The slug belongs to another tenant                                                                                                            |
| `500`  | A database error — **or** generated-slug exhaustion, which is indistinguishable from one                                                      |

A blanket `403` on a key you believe is correct is most often the tenant sync:
if the client entry is missing from `TENANTS_CONFIG_PATH`'s file, or that
variable is unset entirely, the server starts healthy with an **empty** key
store and rejects everything. See
[`fyi-auth-tenancy`](../../fyi-auth-tenancy/).

## The same calls from the CLI

```bash
cargo run -p vym-fyi-client -- --config .docker/tenants.yaml --client client-a ping
cargo run -p vym-fyi-client -- --config .docker/tenants.yaml --client client-a \
  links-create --slug promo-2025 --target https://example.com/landing
cargo run -p vym-fyi-client -- --config .docker/tenants.yaml --client client-a \
  links-list --page 1 --per-page 50 --active true
```

Global options precede the subcommand, and the subcommands are hyphenated
single tokens. See [`fyi-clients`](../../fyi-clients/).
