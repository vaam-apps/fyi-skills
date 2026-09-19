---
name: fyi-auth-tenancy
description: "How vym.fyi decides who a caller is and what they may see — the API-key extractor and its two accepted headers, the master key, the YAML config file that is the real source of truth for tenants and keys, the $(VAR) placeholder resolution, and the boot-time tenant sync that DELETES rows and cascades to API keys. Load before changing auth, editing a tenants config, or planning any operation that adds or removes a tenant."
---

# fyi-auth-tenancy

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

## The config file is the source of truth, not the database

`api_keys` exists as a table. **The auth path never reads it.** Keys and
tenant bindings are derived at boot from a YAML file named by
`TENANTS_CONFIG_PATH`, and the `tenants` table is then forced to match that
file.

```yaml
server:
  base_url: http://localhost:8000
  master_api_key: "$(MASTER_API_KEY)" # optional
clients:
  client-a:
    name: client-a
    api_key: "$(CLIENT_A_SECRET)"
    role: admin # admin | url
```

- The **map key** (`client-a`) is the tenant name and the `X-Client-Id` value.
- `$(VAR)` placeholders resolve against the environment at load time. **A
  missing variable is a hard error** (`AppError::MissingEnvVar`), not an empty
  string. An unterminated `$(` is passed through literally — a deliberate
  choice, and a quiet one.
- `role` is parsed (`admin` / `url`) but **nothing in either server branches
  on it** as of `2ed14f8c`. It is documented as meaningful; treat it as
  inert until you find the code that reads it.

### `TENANTS_CONFIG_PATH` unset is not an error

The builder logs
`warn!("TENANTS_CONFIG_PATH not set; skipping tenant synchronization and API key bindings")`,
constructs an **empty** `ApiKeyStore`, and starts normally. The service is
healthy, `/health` returns `OK`, and **every authenticated request fails**.
That is a silent lockdown, not a crash.

## The destructive part

> **On every boot with `TENANTS_CONFIG_PATH` set, the CRUD server deletes
> every tenant row whose name is not in the config file.**

`sync_tenants_with_repo`:

1. reads every `(id, name)` from `tenants`;
2. **creates** one row (fresh `Uuid::new_v4()`, `status='active'`) per config
   client id not already present;
3. **deletes** — `DELETE FROM tenants WHERE name = $1` — every existing row
   whose name is absent from the config.

`api_keys.tenant_id` is `ON DELETE CASCADE`, so a tenant's keys are deleted
with it. There is no soft delete, no dry run, no confirmation, and no comment
in the source flagging any of this as dangerous.

**Removing a client entry and restarting is a destructive operation. So is
renaming one** — a rename is a delete plus a create, and the new tenant gets a
new UUID.

### …except when it silently fails instead

`short_links.tenant_id` has **no `ON DELETE` clause**, so it defaults to
`NO ACTION`. A tenant that still owns short links cannot be deleted: the
`DELETE` violates the foreign key.

The code does not remove or reassign those links first, and the sync's error
handling does not special-case this. So in practice a removed tenant either
vanishes with its keys (no links) or the sync errors on that row (has links).
**Check which case you are in before assuming a config change will apply
cleanly.**

## The extractor

`ApiKeyAuth`, an Axum `FromRequestParts` (`crates/vym-fyi-server-crud/src/auth.rs`).

Key, in order:

1. `X-API-Key: <key>`
2. `Authorization: ApiKey <key>` — the literal scheme word **`ApiKey`**, one
   space. Not `Bearer`.

Plus `X-Client-Id: <client id>`.

| Outcome                                       | Status                  |
| --------------------------------------------- | ----------------------- |
| No key in either header                       | `401`                   |
| Key present, matched nothing                  | `403`                   |
| Authenticated non-master with no bound tenant | `403` (in the handlers) |

**The master key matches on the key alone**, independent of `X-Client-Id`, and
yields `is_master: true` with `tenant_id: None`. A non-master binding requires
`X-Client-Id` to be present and to equal the binding's client id exactly.

A master caller is **not** scoped: `GET /api/links` gives it `WHERE TRUE` —
every tenant's links.

## The comparison is hand-rolled

`ApiKeyStore::authenticate` defines `constant_time_eq` **inline**, in
`app.rs`. It is not `subtle`, not the `constant_time_eq` crate — neither is a
dependency of this crate.

It is a reasonable implementation: it XOR-accumulates over
`max(len_a, len_b)` using `.get(i).unwrap_or(&0)`, folds the length difference
into the accumulator, and has no early return. It is also **unaudited
first-party crypto-adjacent code**, and nothing in the repository says
otherwise — the only annotation is a doc comment reading
`/// Delegates API key lookup and comparison (constant-time).`

If you are touching this, prefer swapping in `subtle::ConstantTimeEq` over
editing it. If you are reviewing it, do not report it as "uses a
constant-time crate".

## What is not here

- **No endpoint creates, rotates or revokes a key.** `api_keys.revoked_at`
  exists in the schema and is never read or written.
- **No per-tenant rate limits or quotas.** `docs/README.md`'s roadmap lists
  them; nothing implements them.
- **No audit log.** `short_links.created_by_api_key_id` exists and is never
  written, so there is no record of which key created a link.
- **No hashing.** Despite the column being called `key_hash`, the keys the
  auth path compares are the **plaintext** values resolved from the config
  file and the environment. Treat the config file and those environment
  variables as secrets.

## Where to verify

- `crates/vym-fyi-server-crud/src/auth.rs` — the extractor.
- `crates/vym-fyi-server-crud/src/app.rs` — `ApiKeyStore::authenticate`,
  `build_api_key_bindings`, `sync_tenants_with_repo`.
- `crates/vym-fyi-model/src/services/config.rs` — loading and
  `resolve_env_placeholders`. Its two unit tests cover substitution and the
  missing-variable error; `crates/vym-fyi-model/tests/config_flow.rs` covers
  the whole load-and-resolve path end to end against a temp file.
- `.docker/tenants.yaml` — a real, working example.
