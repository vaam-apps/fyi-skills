# fyi-skills

Agent skills for [vym.fyi](https://github.com/vaam-apps/fyi) — a tiny,
API-only, multi-tenant URL shortener in Rust.

vym.fyi is small, and that is the problem. It is small enough that an agent
will assume it can read the whole thing and be right about it — and small
enough that nobody has built the guard rails that would catch a wrong
assumption. There is no test that touches the database. There is no query
checked against the schema, at build time or ever. The redirect service has
no tests at all. And the repository's own documentation is wrong about
several things an agent would act on, including what the CRUD API can do and
what status the redirect returns.

These skills are the context, and the honesty. Install the one that matches
the work:

```bash
npx skills add https://github.com/vaam-apps/fyi-skills --skill fyi
```

Start with `fyi`. It is the orientation skill and it routes to the rest.
Adding more later is the same command with a different `--skill`;
`--skill '*'` takes all nine.

**If you read only one besides `fyi`, read
[`fyi-docs-drift`](skills/fyi-docs-drift/).** It is the enumerated list of
places where this repository's documentation and its code disagree, with the
file and line behind each one.

## Upgrading

```bash
npx skills update                   # every installed skill, from every source
npx skills update fyi fyi-crud-api  # just these
npx skills ls                       # what is installed, and from where
```

`update` (alias `upgrade`) re-fetches from the default branch and rewrites the
`computedHash` in `skills-lock.json`. **Commit that lockfile** — it, not the
install command, is what pins you: a project keeps the exact content it
installed until someone runs `update`. `npx skills experimental_install`
restores a checkout from the lockfile, which is what a fresh clone or a CI job
wants.

**Before you upgrade, read [CHANGELOG.md](CHANGELOG.md)** — specifically the
entries naming a claim that **stopped being true**, which is the thing that
will break an integration written against the old page.

**Do not upgrade blindly if you are pinned to an older fyi.** These skills
track `main`. [VERSIONING.md](VERSIONING.md) has the full policy.

**Do not hand-edit an installed skill.** The lockfile hashes it, so a local
edit reads as drift rather than as an intended change — and the next `update`
silently overwrites it. Send a PR here instead.

## The skills

| Skill                                          | Load it when                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [`fyi`](skills/fyi/)                           | Anything in the repo. Orientation, the workspace, the patterns      |
| [`fyi-docs-drift`](skills/fyi-docs-drift/)     | **Before trusting any documented claim.** The enumerated drift list |
| [`fyi-crud-api`](skills/fyi-crud-api/)         | The write API — routes, link creation, listing, status codes        |
| [`fyi-redirect`](skills/fyi-redirect/)         | The read path, its status code, its metrics cardinality             |
| [`fyi-auth-tenancy`](skills/fyi-auth-tenancy/) | API keys, the master key, the config file, the destructive sync     |
| [`fyi-data`](skills/fyi-data/)                 | Schema, repositories, slug generation, `AppError`                   |
| [`fyi-clients`](skills/fyi-clients/)           | The CLI, the Node binding, the shared query adapter                 |
| [`fyi-ops`](skills/fyi-ops/)                   | Docker, Helm, compose, metrics, health, static assets               |
| [`fyi-tooling`](skills/fyi-tooling/)           | CI, release-please, cargo-deny, commit messages                     |

## Why a separate repository

Two reasons, and the second is the load-bearing one.

A skill is **installed, not cloned**. `npx skills add` fetches one directory
into `.agents/skills/` and pins its hash in `skills-lock.json`. That works for
any project that _calls_ vym.fyi — someone integrating against the CRUD API
gets `fyi-crud-api` and `fyi-auth-tenancy` without vendoring the tree.

And skills must be able to **move at a different speed from the code**. A
skill is not documentation-of-record; it is a briefing, and a briefing that
has to clear the full CI gate to be corrected is a briefing nobody corrects.
That matters more here than usual: several of the drift items
`fyi-docs-drift` lists are exactly the kind of small correction that never
gets made because it does not feel worth a PR against the main repository.

The cost of that separation is drift, and drift is what the gate below exists
to refuse.

## The parity rule

> **Every feature lands in three places or it has not landed: the code, the
> docs, and the skills.**

A document that lags is worse than none, because people trust it. A skill that
lags is worse still, because an agent does not merely trust it — it **acts**
on it, at machine speed, across every session that loads it.

So this repository ships a gate, and it fails in **both** directions:

```bash
node tools/verify-coverage.mjs /path/to/fyi
```

- **docs → skills.** A fyi documentation page — a `docs/**/*.md`, a
  `crates/**/Cargo.toml` or README, or a `charts/*/Chart.yaml` — that no skill
  claims fails the gate.
- **skills → docs.** A path claimed in `coverage.json` that no longer exists
  in fyi fails the gate.

A one-directional gate rots in the direction nobody looks.

**The `crates/**/Cargo.toml` half is the one that will actually fire.** It
keys on the manifest rather than the README deliberately: two crates
(`vym-fyi-healthcheck`, `vym-fyi-node`) have no README at all, so a
README-keyed surface would not see them — which is precisely the "a component
shipped and nobody wrote a briefing" case the gate exists for. A seventh crate
fails the gate by name.

`coverage.json` is the map. **The gate checks the claim exists; a reviewer
checks it is true.** It cannot read prose.

CI runs the gate against fyi's `main` daily and on every push. The checkout is
full-depth, deliberately — the gate asks git _when_ a page was added.

## Versioning — read this before you trust a skill

> **A skill is true of _a_ fyi, not of fyi.**

Every `SKILL.md` is stamped, under its title, with the fyi commit it was
verified against:

> **Verified against fyi `2ed14f8c` (2026-09-19).**

That stamp is machine-enforced — the gate refuses a skill that carries none,
or one whose stamp is not the baseline or a descendant of it.

Full policy: [VERSIONING.md](VERSIONING.md). What changed between releases,
including any claim that **stopped** being true: [CHANGELOG.md](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: a skill is judged
on whether an agent that read it does the right thing. **Prefer the caveat
over the tour**, date anything that could go stale, and **check the code, not
fyi's own docs.**

## Licence

MIT, matching fyi.
