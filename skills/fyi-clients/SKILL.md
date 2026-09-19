---
name: fyi-clients
description: "The three things that call vym.fyi's CRUD API — the Clap CLI, the N-API v3 Node binding, and the shared LinkListQueryAdapter that keeps their query parameters identical. Covers every subcommand and flag, how each authenticates, what the Node addon exports, and the fact that nothing in the repository builds or publishes that addon. Load before using, extending or packaging any client."
---

# fyi-clients

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

Two clients, one shared query-parameter adapter. Both authenticate the same
way and both go through `HttpClient::global()` — **do not build an ad-hoc
`reqwest` client** (`fyi-data` has its settings).

## The CLI — `vym-fyi-client`

Global options come **before** the subcommand:

| Option            | Short | Env              | Default       |
| ----------------- | ----- | ---------------- | ------------- |
| `--config <PATH>` | `-c`  | `VYM_FYI_CONFIG` | `config.yaml` |
| `--client <ID>`   | `-i`  | `VYM_FYI_CLIENT` | **required**  |
| `--use-master`    | —     | —                | off           |

Subcommands — **hyphenated, one token each**:

| Subcommand     | Flags                                                                                                                                           | Calls                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `ping`         | —                                                                                                                                               | `GET {base_url}/health`     |
| `links-create` | `--slug` (optional), `--target` (required)                                                                                                      | `POST {base_url}/api/links` |
| `links-list`   | `--page`, `--per-page`, `--slug`, `--target-contains`, `--active`, `--created-before`, `--created-after`, `--expires-before`, `--expires-after` | `GET {base_url}/api/links`  |

> `docs/arc42.md` §6.2 shows `vym-fyi-client links create …` — **two tokens.**
> That does not parse. `docs/README.md`'s walkthrough is correct. See
> [`fyi-docs-drift`](../fyi-docs-drift/).

**Authentication**: it loads the YAML config named by `--config`, resolves the
`--client` entry (including `$(VAR)` placeholders), and sends
`X-API-Key: <resolved key>` plus `X-Client-Id: <client id>` on every request.
`--use-master` substitutes `server.master_api_key` for the key while **still
sending the same `X-Client-Id`** — the server accepts a master key for any
client id.

`ping` hits `/health`, which is **unauthenticated**, so a successful `ping`
proves reachability and nothing about your credentials. Use `links-list` to
test a key.

`links-list` prints the raw response body and the status; it does not parse or
pretty-print. Base URLs are trimmed of a trailing `/`.

## The shared adapter

`LinkListQueryAdapter` + `QueryParamsBuilder`
(`crates/vym-fyi-model/src/services/query_adapter.rs`) exist so the two
clients cannot drift apart on parameter names. `QueryParamsBuilder` has two
verbs: `push_value` (emits when `Some`) and `push_trimmed` (trims, emits only
when non-empty after trimming).

Both implementations emit exactly these keys, in this order:

```text
page  per_page  slug  target_contains  active
created_before  created_after  expires_before  expires_after
```

They match `ListLinksQuery` on the server (`fyi-crud-api`). **If you add a
filter, add it in three places** — the server's query struct, the CLI's
`LinksListParams`, and the Node binding's `ListLinksInput` — or the clients
silently stop being able to express it.

## The Node binding — `vym-fyi-node`

`crate-type = ["cdylib"]`, **napi-rs v3** with the `napi6` ABI feature and
`tokio_rt`. `build.rs` is three lines: `napi_build::setup()`.

Exports three async functions and four object types:

```text
ping(options: CrudOptions, use_master?: boolean): Promise<void>
create_link(options: CrudOptions, input: CreateLinkInput): Promise<LinkResponse>
list_links(options: CrudOptions, input: ListLinksInput): Promise<LinkResponse[]>

CrudOptions    { base_url, client_id, api_key, master_api_key? }
CreateLinkInput{ slug?, target_url, use_master? }
ListLinksInput { page, per_page, slug, target_contains, active,
                 created_before, created_after, expires_before, expires_after,
                 use_master? }
LinkResponse   { slug, target_url, active }
```

Auth is identical to the CLI's: `X-API-Key` + `X-Client-Id`, with
`CrudOptions::api_key(use_master)` choosing between the two keys. **Unlike the
CLI it takes credentials directly** rather than reading a YAML file — there is
no config loading on this path.

> **Nothing in this repository builds or publishes the addon.** The
> `Dockerfile` builds only `vym-fyi-server-crud`, `vym-fyi-server-redirect`
> and `vym-fyi-healthcheck`; no workflow runs `napi build`; there is no
> `package.json`, no `.node` artifact and no npm publish step. The crate
> compiles as part of `cargo check --all-targets` and that is the full extent
> of its CI. Do not assume a consumable package exists.
>
> `docs/arc42.md` omits this crate from its workspace inventory entirely.

## `vym-fyi-healthcheck`

Grouped under `fyi-ops` because its reason for existing is the container
`HEALTHCHECK`, but it is a third client in shape: a **zero-dependency**
binary — its `[dependencies]` section is empty — that hand-writes an HTTP/1.1
`GET` over a raw `TcpStream` and parses the status line itself. See
[`fyi-ops`](../fyi-ops/) for its flags, its defaults and the port mismatch to
watch for.
