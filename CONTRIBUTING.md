# Contributing

A skill is judged on **whether an agent that read it does the right thing**, not
on whether it is complete.

## What a good skill looks like here

**Prefer the caveat over the tour.** An agent can read the code. What it cannot
recover from the code is the trap: that the CRUD server **deletes** tenant rows
absent from the config file on every boot, that `generate_slug` rounds its
length up to an even number so asking for 7 gives you 8, that `AppError` has no
`IntoResponse` impl so every variant but `Conflict` becomes an opaque `500`.
Those sentences are the product.

**Check the code, not fyi's own docs.** This is the rule that matters most in
this repository, and it is why `fyi-docs-drift` exists as a skill of its own.
fyi's `docs/` and `AGENTS.md` are good and were clearly written with care, but
several claims in them are no longer — or were never — true of the code. A skill
that faithfully copies a wrong document is worse than no skill, because it
launders a stale claim into something an agent will act on. **Open the file.**

**Say what is not built, and name it.** `docs/README.md` carries a roadmap of
things that do not exist (per-tenant rate limits, audit logs, hot-slug caching,
soft delete). Those read as features to an agent skimming for capability. Name
them as absent.

**Date anything that could go stale.** See [VERSIONING.md](VERSIONING.md).

**Correct, do not overwrite.** Strike the old claim through and date the
correction. The wrong belief is usually the one the reader was about to form.

**Quote the description.** The YAML frontmatter is parsed by a real YAML parser
in `npx skills add`, and an unquoted value containing `": "` is a nested mapping
— the installer **skips the skill outright**. The gate refuses that, but wrap it
anyway.

## The shape

```text
skills/<name>/
  SKILL.md              # frontmatter, the version stamp, then the prose
  references/*.md       # detail pages, each LINKED from SKILL.md
```

- `name:` in the frontmatter **must equal the directory name** — that is what
  `--skill` resolves.
- `description:` is the **only** thing an agent reads when deciding whether to
  load the skill. Say what it covers **and** when to reach for it. Under 80
  characters fails the gate.
- Every `references/*.md` must be linked from `SKILL.md`, and every link must
  resolve. An unreferenced reference page is a page no agent will ever open.
- Keep `SKILL.md` readable in one sitting. Push detail into `references/`.

## The gate

```bash
node tools/verify-coverage.mjs /path/to/fyi
```

It fails in both directions, and it also checks frontmatter validity, the
description length, the version stamp, and reference linkage.

**Run it before opening a PR**, and run it against the fyi checkout you actually
verified against. It needs a **full-depth** clone, not a shallow one — it asks
git when a page was added.

## Adding coverage for a new fyi component

The `crates/**/Cargo.toml` surface means **a new crate fails the gate by name**
until some skill claims it. That is deliberate: a seventh crate is a component
nobody has briefed an agent about.

1. Read the crate — the code, and its README if it has one (two crates do not).
2. Fold it into the **owning** skill's prose. Resist adding a skill: nine is
   already a routing decision an agent has to make.
3. Add the crate root **and** the specific source paths to that skill's `covers`
   in `coverage.json`.
4. Re-stamp that skill with the fyi commit you verified against.
5. Run the gate.

**Adding a path to `covers` without writing the prose passes the gate and
defeats the point.** The gate checks the claim exists; you are the part that
checks it is true.

## Changing a claim

If fyi changed under a skill, the change here is not "edit the sentence". It is:

- correct the sentence, struck through and dated;
- re-stamp the skill;
- add a `CHANGELOG.md` entry **naming the claim that stopped being true**, which
  is the entry someone upgrading actually needs.

## Formatting

Prettier, 80 columns, `proseWrap: preserve`:

```bash
npx --yes prettier@3 --check "**/*.{md,json,yml}"
```

## Commit messages

Conventional Commits, enforced org-wide by the `pr-title` workflow on the squash
title. One extra rule worth knowing, because it fails silently rather than
loudly: **a commit-message body line must not begin with `identifier(` containing
nested parentheses.** release-please parses bodies with a strict PEG grammar that
reads such a line as a type-and-scope header, and a nested `(` inside it is a
syntax error that makes it discard the **whole commit** — no changelog entry, no
version bump, nothing red anywhere. fyi's own repository runs a
`ci/commit-message-parse` job against this exact hazard. Put a word in front of
it, or reword.

## Where the source of truth lives

**The fyi source, always — and specifically the `.rs` files, not `docs/`.** When
this repository and fyi disagree, fyi's code is right. When this repository and
fyi's _documentation_ disagree, check the code before assuming either is right;
several documented claims are already stale, and
[`fyi-docs-drift`](skills/fyi-docs-drift/) is the running list. If you find a new
one, add it there as well as fixing the skill that repeated it.
