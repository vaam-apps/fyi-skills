# Versioning

> **A skill is true of a fyi, not of fyi.**

This is the failure mode this page exists to prevent:

> An agent loads `fyi-auth-tenancy`, reads that the CRUD server deletes any
> tenant row whose name is absent from the config file, and writes a
> provisioning script that assumes it. The claim is true of `main`. The
> operator is pinned to an older commit where the sync behaved differently, or
> to a newer one where it does not. Nothing in the skill said when it became
> true, so nothing warned anyone.

The inverse is just as bad and harder to spot: a skill that still describes
something the current fyi has removed, which an agent then faithfully
reproduces.

## What a fyi "version" actually is

fyi **does** cut releases — `release-please` versions the workspace and
`.github/workflows/` publishes container images and Helm charts. But a skill
describes the **tree**, not a release, and the tree moves between tags. A skill
correct at one release can be wrong three merges later without any version
number changing.

So the identity a skill carries is **a commit and a date**.

**Follow that convention.** It is the whole mechanism — and it matters more here
than in a repository with thick prose docs, because fyi's own documentation is
thin and several of its pages already disagree with the code (see
`fyi-docs-drift`'s list). A dated claim is the only thing that lets a reader
tell "this was checked" from "this was assumed".

## The three rules

### 1. Every `SKILL.md` names the fyi it was verified against

Directly under the title:

```markdown
> **Verified against fyi `2ed14f8c` (2026-09-19).** Version-sensitive claims
> below carry the date they became true. On an older or newer fyi, trust the
> repository over this page.
```

`coverage.json`'s `baseline` block carries the same ref in machine-readable
form, and `tools/verify-coverage.mjs` prints how far the checkout you gave it
has drifted.

**A stamp may be newer than the baseline; it may never be older or unrelated.**
Re-verifying one skill against a later fyi and stamping just that one is correct
and expected — the gate checks only that the stamped commit _contains_ the
baseline. Requiring all nine stamps to move together would make a one-skill
correction cost a full re-verification pass, which is how you get nine
rubber-stamps.

The baseline also governs coverage. A claim on a **directory** covers the pages
that existed when the claim was made; a page added under a claimed directory
_since_ the baseline fails the gate by name, because inheriting the parent's
claim would hide exactly the case the gate exists to catch. In practice that is
the case this repository most expects to hit: a seventh crate added under
`crates/` is a component nobody wrote a briefing for, and the gate names it.

### 2. A version-sensitive claim carries the date it became true

Not "the redirect returns 307" but "**307 Temporary Redirect as of
2026-09-19**" — with the file and line, because that is a single constant that a
one-line change can flip, and every integrator's caching behaviour depends on
it.

A claim is version-sensitive if a reader on a six-week-old checkout would be
misled by it. In practice that is most claims about:

| Kind of claim          | Write it as                                        |
| ---------------------- | -------------------------------------------------- |
| A route exists         | "`<METHOD> <path>`, as of `<date>`"                |
| A status code          | "`<N>` as of `<date>`" — never a bare status       |
| A header is accepted   | "`<header>`, as of `<date>`"                       |
| A default              | "`<N>` — it was `<M>` until `<date>`"              |
| A retry/limit constant | "`<N>` attempts (`<file>:<line>`), as of `<date>`" |
| A count of anything    | "N as of `<date>`", never a bare N                 |

The cost of the date is six characters. The cost of omitting it is an agent
confidently generating a client against a wire contract that does not match the
tree it is editing.

### 3. Say what it was before

When you correct a skill because fyi changed, **strike the old claim through and
date the correction** rather than overwriting it:

```markdown
~~`AppError` maps to an HTTP status through an `IntoResponse` impl.~~
**Corrected 2026-09-19:** there is no such impl anywhere in the workspace. The
only mapping is one hand-written `match` in `handlers/links.rs` that turns
`AppError::Conflict` into `409` and everything else into `500`.
```

This is not sentimentality. It tells a reader two things they cannot get any
other way: which sentences on the page have been looked at recently, and what
the plausible-but-wrong belief was — usually the one they were about to form.

## Releases

This repository tags a release whenever a batch of skills is re-verified against
a newer fyi. A tag names the **date of verification and the fyi commit it was
verified against**:

```text
v2026-09-19-2ed14f8c
```

`CHANGELOG.md` records, per release: the fyi range covered, which skills
changed, and — most importantly — **any claim that stopped being true**, so
someone upgrading can find the thing that will break them.

## Installing, upgrading, and what actually pins you

```bash
npx skills add https://github.com/vaam-apps/fyi-skills --skill fyi
npx skills update                 # re-fetch every installed skill
npx skills update fyi fyi-crud-api
npx skills ls                     # what is installed, and from where
npx skills experimental_install   # restore a checkout from skills-lock.json
```

**`add` and `update` both fetch the default branch.** There is no `--ref` or
`--tag` on either, so a tag in this repository is a _human_ reference point —
something to read `CHANGELOG.md` against — not something the installer can
resolve.

**What pins you is the lockfile, not the command.** `skills-lock.json` records a
`computedHash` of the exact content installed, and a project keeps that content
until someone runs `update`. So:

- **Commit `skills-lock.json`.** It is the only record of which briefing your
  agents are actually running.
- **`experimental_install` is the reproducible path** — a fresh clone or a CI job
  restores exactly what the lockfile names.
- **Do not hand-edit an installed skill.** The hash makes a local edit read as
  drift, and the next `update` silently overwrites it.

### Upgrading deliberately

`update` is a re-fetch, not a merge: it takes whatever `main` says now. Three
things to do before running it, in descending order of how much they matter:

1. **Read `CHANGELOG.md` between your lockfile's release and now**, specifically
   the entries naming a claim that **stopped being true**. A new claim is
   additive; a retired one is what breaks an integration written against the old
   page.
2. **Check how far your fyi has drifted.** Run the gate against your own
   checkout — it reports the distance from the baseline in commits and dates:

   ```text
   baseline: these skills were verified against fyi 2ed14f8c (2026-09-19);
   this checkout is 1a2b3c4d (2026-08-02) — 0 commit(s) newer,
   38 commit(s) it does not have.
   ```

   Run against an **older** fyi the gate will legitimately fail on paths that do
   not exist there yet. That is not a bug; it is the tool telling you these
   skills are newer than your tree.

3. **If you are pinned to an old fyi, do not silently take the latest skills.**
   That is precisely the case where a skill will confidently describe a route or
   a header your tree does not serve.

### Downgrading

There is no `--ref`, so the honest answer is: check out the tag of this
repository whose fyi commit is nearest yours, and `npx skills add` from that
local path. Rare enough that it has not been made a first-class flow.

## What the gate can and cannot tell you

`tools/verify-coverage.mjs` checks that every fyi documentation page — a page
under `docs/`, a crate manifest or README under `crates/`, or a Helm
`Chart.yaml` — is claimed, and that every claimed path exists in the checkout
you point it at.

**It cannot read prose.** It cannot tell you that a sentence about a status code
is true. Only a dated claim and a reader can do that — and in this repository
specifically, the reader has to check the code rather than fyi's own docs, for
the reasons `fyi-docs-drift` lists.
