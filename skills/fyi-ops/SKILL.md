---
name: fyi-ops
description: "Running vym.fyi — the musl cross-compiling multi-stage Dockerfile and its three targets, the zero-dependency healthcheck binary and the port mismatch that makes its defaults misleading, the two Helm charts on bjw-s app-template, the compose stack with its generated Grafana dashboards, and every Prometheus metric the services emit. Load before touching the Dockerfile, a chart, a probe, compose, or anything about metrics and static assets."
---

# fyi-ops

> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page. See
> [VERSIONING.md](https://github.com/vaam-apps/fyi-skills/blob/main/VERSIONING.md).

## The image build

One multi-stage `Dockerfile`, `# syntax=docker/dockerfile:1.5`.

| Stage      | From                                        | Produces                                       |
| ---------- | ------------------------------------------- | ---------------------------------------------- |
| `base`     | `rust:1`                                    | `OPENSSL_STATIC=1`, `WORKDIR /app`             |
| `builder`  | `base`                                      | the three binaries, statically linked musl     |
| `baseprod` | `gcr.io/distroless/static-debian12:nonroot` | labels only                                    |
| `crud`     | `baseprod`                                  | `vym-fyi-crud` + `healthcheck` + `static/`     |
| `redirect` | `baseprod`                                  | `vym-fyi-redirect` + `healthcheck` + `static/` |

Cross-compilation is explicit rather than implicit: `ARG TARGETARCH` switches
`amd64` → `x86_64-unknown-linux-musl` (linker `musl-gcc`) and `arm64` →
`aarch64-unknown-linux-musl`, and **exits 1 on any other arch** rather than
silently building the wrong thing. The build is
`cargo build --profile prod --locked -p vym-fyi-server-crud -p
vym-fyi-server-redirect -p vym-fyi-healthcheck`, using BuildKit bind mounts
for the crates it needs and cache mounts for `target/` and the cargo
registry.

**`--locked` matters**: a stale `Cargo.lock` is a red image build even when
`cargo test` is green. That is why release-please refreshes lockfiles (see
`fyi-tooling`).

**`vym-fyi-node` and `vym-fyi-client` are not built here.** Nothing in the
image pipeline produces the Node addon.

Both runtime images are distroless static `nonroot` — **no shell, no package
manager** — carrying only the binary, `healthcheck`, and `static/`. They set
`RUST_LOG=warn`, `PORT=8000`, `USER nonroot:nonroot`, and `EXPOSE $PORT`.

## The healthcheck binary, and the port trap

`crates/vym-fyi-healthcheck` has an **empty `[dependencies]`**. It opens a
`TcpStream` with a connect timeout, hand-writes an HTTP/1.1 request
(`Connection: close`, `User-Agent: vym-fyi-healthcheck`), reads the response
and parses the status line itself. Exit `0` for `200..=299`; exit `1` for a
config error, a connect/read/write failure, or any other status.

| Env                 | Flag           | Default                                |
| ------------------- | -------------- | -------------------------------------- |
| `HOST`              | `--host`       | `127.0.0.1`                            |
| `PORT`              | `--port`       | **`3000`**                             |
| `HEALTH_PATH`       | `--path`       | `/health`                              |
| `HEALTH_TIMEOUT_MS` | `--timeout-ms` | `3000`                                 |
| `HEALTH_SCHEME`     | —              | `http` only; anything else is an error |

> **Its default port is `3000`; the services listen on `8000`.** That is why
> both `HEALTHCHECK` lines pass `--port 8000` explicitly:
>
> ```
> HEALTHCHECK --interval=10s --timeout=3s --start-period=2s --retries=5 \
>   CMD ["/app/healthcheck", "--port", "8000", "--path", "/health"]
> ```
>
> Run it by hand with no arguments against a running container and it fails
> for a reason that has nothing to do with the service's health. If you change
> `PORT`, change the `HEALTHCHECK` and the chart probes too.

The Helm charts use `httpGet` probes rather than this binary, so the two
mechanisms are independent.

## Helm

Two charts, one per service, identical in shape:

- `charts/vym-fyi-server-crud`, `charts/vym-fyi-server-redirect`
- `apiVersion: v2`, `type: application`, chart **`version: 1.0.0`** (static,
  human-bumped), `appVersion: "1.0.1"` carrying the
  `# x-release-please-version` marker.
- Dependencies: **`app-template` `4.0.1`** from `bjw-s-labs.github.io/helm-charts`,
  aliased `crud`/`redirect`, plus Bitnami `common` `2.x.x`.

Notable values: images `ghcr.io/vymalo/fyi-crud` and
`ghcr.io/vymalo/fyi-redirect` tagged `{{ .Values.global.version }}` (default
`latest`); requests `125m`/`256Mi`, limits `400m`/`512Mi`;
`runAsUser`/`runAsGroup` `1001`; startup, readiness and liveness probes all
`httpGet /health` on `8000`; podAntiAffinity on
`app.kubernetes.io/name`.

The CRUD chart additionally offers a `configMaps.tenants` block — **disabled
by default** — mountable at `/config/tenants.yaml`, and env placeholders
`MASTER_API_KEY`, `CLIENT_A_SECRET`, `CLIENT_B_SECRET` defaulting to empty
strings. Its `DATABASE_URL` default is a plaintext
`postgres://vymalo:vymalo@db:5432/vymalo`; the redirect chart's is
`DATABASE_URL_RO` at the same address. **Both defaults are placeholders, not
configuration** — and note that with `configMaps.tenants` off and
`TENANTS_CONFIG_PATH` unset, the CRUD service starts locked down and healthy
(`fyi-auth-tenancy`).

> **Only `appVersion` is release-please-managed.** `version:` is bumped by a
> human when the chart actually changes. The repository's own
> `release-please.yml` comment cites the sibling `image-resizer` repo as the
> cautionary example of what happens when the two are coupled and then
> diverge.

## Compose and the generated dashboards

`docker compose up --build` brings up Postgres (`db`), `crud`, `redirect`,
`prometheus`, `grafana-dashgen` and `grafana`.

`grafana-dashgen` is the interesting one: a one-shot `python:3.12-slim`
container that `pip install`s [`grafanalib`](https://github.com/weaveworks/grafanalib)
and runs `generate-dashboard` over each `.docker/grafana/dashboards/*.dashboard.py`,
writing JSON into a named volume. Grafana `depends_on` it with
`condition: service_completed_successfully`, so dashboards exist before it
starts.

Five dashboards, all parameterised with template variables
(`$status`, `$client_ip`, `$slug`): CRUD API Overview, Redirector Overview,
Redirect – By Client IP, Redirect – By Slug, Redirect – IP × Slug. Grafana is
on `http://localhost:3000`, `admin`/`admin`.

**Dashboards are code, in Python.** Editing JSON in the Grafana UI is
throwaway; edit the `.dashboard.py`.

## Metrics

Two layers on both services.

**`axum-prometheus`**, via `prometheus_layer_default()`, which ignores
`/health` and `/metrics`. Emits the `axum_http_requests_*` family.

**`record_ip_metrics`** middleware (`vym-fyi-model/src/services/axum_metrics.rs`),
which skips the same two paths:

| Metric                          | Labels                                                |
| ------------------------------- | ----------------------------------------------------- |
| `http_requests_by_ip_total`     | `method`, `path`, `status`, `client_ip`, `user_agent` |
| `http_request_duration_seconds` | `method`, `path`, `status`                            |
| `http_response_size_bytes`      | same (only when `Content-Length` is present)          |
| `http_request_errors_total`     | same + `class` (`4xx`/`5xx`/`other`)                  |
| `http_cache_status_total`       | same + `cache_status`                                 |

Plus, on the redirect service only, `redirect_slug_requests_total{slug, slug_len}`.

`client_ip` prefers the first value of `X-Forwarded-For`, then
`ConnectInfo<SocketAddr>`, then `"unknown"` — **it trusts the header
unconditionally**, so behind anything other than a trusted proxy it is
caller-controlled. `cache_status` is read from `x-cache`, `x-cache-status` or
`cf-cache-status`, falling back to `"hit"` if an `Age` header is present, else
`"none"`.

> **`path` is the raw request path, unbucketed, on both services** — and on
> the redirect service every path is a slug. Combined with an
> unauthenticated catch-all route, that is unbounded label cardinality for a
> scanner. See `fyi-redirect`.

**`/metrics` is unauthenticated on both services.**

## Static assets

`attach_static_routes` nests `ServeDir::new("static")` at `/static` and
redirects `/favicon.ico` there permanently. `not_found()` and
`internal_error()` read `static/404.html` and `static/500.html`.

Everything here is **relative to the process working directory at request
time**, not embedded at compile time. If the file cannot be read, a hardcoded
string is substituted silently and the status is still correct — so a missing
`static/` directory degrades invisibly. Both runtime images `COPY static/`;
a local `cargo run` from anywhere but the repository root will not find it.
