#!/usr/bin/env node
// verify-coverage — the parity gate for this repository.
//
// It fails in BOTH directions, deliberately:
//
//   docs -> skills   a fyi documentation page that no skill claims fails
//                    the gate. That is the half that catches "a feature
//                    shipped and nobody taught the agents about it".
//
//   skills -> docs   a path claimed in coverage.json that does not exist in
//                    the fyi checkout fails the gate. That is the
//                    half that catches a skill still describing something
//                    that moved, was renamed, or was deleted.
//
// A one-directional gate lets the map rot in the direction nobody looks.
//
// ---------------------------------------------------------------------------
// Adapted from vaam-apps/vpay-skills and vaam-apps/vsms-skills. What differs,
// and why — read this before "fixing" it back toward either exemplar.
// ---------------------------------------------------------------------------
//
// 1. THE SENTINEL IS NOT `AGENTS.md`, EVEN THOUGH fyi HAS ONE. Both
//    exemplars test for an `AGENTS.md` to decide "does this look like a real
//    checkout". fyi does have one — but it is a **symlink** to `CLAUDE.md`
//    (git mode `120000`), and a checkout on a filesystem that did not
//    materialise the symlink leaves `existsSync` returning false on a file
//    that is, as far as git is concerned, present. A bare `AGENTS.md` test
//    is also not identifying: half the repositories on the machine have one.
//    So this checks the workspace manifest instead — `Cargo.toml` naming
//    `crates/vym-fyi-model` as a member, which nothing else does.
//
// 2. THE REPOSITORY IS `fyi`; THE CRATES ARE `vym-fyi-*`; THE PRODUCT IS
//    `vym.fyi`. The skills are prefixed `fyi-` after the repository, because
//    that is what an installer's `--skill fyi-…` has to look like, not after
//    the crate prefix.
//
// 3. THE DOCS SURFACE IS REAL AND WAS ENUMERATED, NOT ASSUMED. vpay's gate
//    walks `docs/flows/` — a "one page per feature" index that, per
//    vsms-skills' own CHANGELOG, never existed in vsms and had to be
//    replaced there. Nothing of the sort exists in fyi either, and fyi's
//    `docs/` is three pages, which is not a feature index by itself. What
//    DOES exist, machine-enumerable and genuinely one-file-per-topic:
//
//      docs/**/*.md              the mkdocs tree (mkdocs.yml's own `nav`)
//      crates/**/Cargo.toml      one manifest per component — THE feature
//                                index here, and deliberately the manifest
//                                rather than the README, because two crates
//                                (`vym-fyi-healthcheck`, `vym-fyi-node`)
//                                have no README at all. Keying on READMEs
//                                would make those two invisible to the gate,
//                                which is exactly the "a component shipped
//                                and nobody wrote a briefing" case it exists
//                                to catch.
//      crates/**/*.md            the four crate READMEs that do exist
//      charts/*/Chart.yaml       one chart per deployable service
//
//    Each is walked RECURSIVELY, for the reason vsms-skills learned the
//    hard way: enumerating one level of a tree that later grows a
//    sub-directory sees half the pages and reports success — a gate whose
//    green means less than it looks.
//
// 4. `ancestors()` IS GENERALISED, NOT HARDCODED. vsms's version hardcodes
//    `backends/crates/<name>` / `backends/apps/<name>`. Here a directory
//    claim is valid for any directory STRICTLY BELOW a surface root: a
//    claim on `crates/vym-fyi-model` covers that crate's files, a claim on
//    bare `crates` is not a claim at all. That is the same rule vsms
//    arrived at by hand (it removed blanket `docs/runbooks` and
//    `docs/design` entries for exactly this reason), expressed once
//    instead of per-surface.
//
// Usage:  node tools/verify-coverage.mjs [path-to-fyi-checkout]
//         FYI_REPO=/path/to/fyi node tools/verify-coverage.mjs
//
// Exit 0 = parity. Exit 1 = a gap, named, with the file that closes it.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fyi = resolve(
  process.argv[2] ?? process.env.FYI_REPO ?? "../fyi",
);

// See adaptation note 1: fyi's `AGENTS.md` is a symlink and a bare
// `AGENTS.md` test is not identifying anyway, so the sentinel is the
// workspace manifest and a member only this repository has.
const manifest = join(fyi, "Cargo.toml");
if (
  !existsSync(manifest) ||
  !/"crates\/vym-fyi-model"/.test(readFileSync(manifest, "utf8"))
) {
  console.error(
    `verify-coverage: ${fyi} does not look like a fyi checkout ` +
      `(no Cargo.toml naming "crates/vym-fyi-model" as a workspace member).\n` +
      `Pass the path: node tools/verify-coverage.mjs /path/to/fyi`,
  );
  process.exit(2);
}

const coverage = JSON.parse(readFileSync(join(REPO, "coverage.json"), "utf8"));
const failures = [];
const note = (s) => failures.push(s);

// A deliberately strict, dependency-free reader for the tiny subset of YAML a
// SKILL.md frontmatter is allowed to be: top-level `key: value` scalars only.
// It REJECTS what a real YAML parser rejects — chiefly an unquoted value
// containing ": ", which YAML reads as a nested mapping and which makes
// `npx skills add` skip the skill outright. Being stricter than the installer
// is safe; being looser is how a skill ships uninstallable and nothing says so.
function parseFrontmatter(text) {
  const value = {};
  for (const [i, raw] of text.split("\n").entries()) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      return { error: `line ${i + 1}: unexpected indentation (nested YAML)` };
    }
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(raw);
    if (!m) return { error: `line ${i + 1}: not a "key: value" pair` };
    const key = m[1];
    const v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
      (v.startsWith("'") && v.endsWith("'") && v.length > 1)
    ) {
      value[key] = v.slice(1, -1).replace(/\\"/g, '"');
      continue;
    }
    if (v.includes(": ") || v.endsWith(":")) {
      return {
        error:
          `line ${i + 1}: "${key}" has an unquoted value containing ": ", ` +
          `which YAML reads as a nested mapping. Wrap the value in double quotes.`,
      };
    }
    if (/^[[{>|&*!%@`]/.test(v)) {
      return { error: `line ${i + 1}: "${key}" starts with a YAML indicator` };
    }
    value[key] = v;
  }
  return { value };
}

// ------------------------------------------------------------------- baseline
//
// A skill is true of *a* fyi, not of fyi. The project does cut
// release-please releases, but a skill describes the TREE, not a release, and
// the tree moves between tags — so the honest version identity is a commit
// and a date.
//
// This is REPORTED, never failed. Drift is the normal state between releases;
// what matters is that whoever reads the output knows it exists.

const baseline = coverage.baseline ?? {};
let drift = null;

const git = (...args) =>
  execFileSync("git", ["-C", fyi, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

if (baseline.fyiRef) {
  try {
    const head = git("rev-parse", "HEAD");
    const headShort = head.slice(0, 8);
    const headDate = git("log", "-1", "--format=%cs", "HEAD");

    if (head.startsWith(baseline.fyiRef) || baseline.fyiRef.startsWith(head)) {
      drift =
        `baseline: fyi ${headShort} (${headDate}) — exactly the tree these ` +
        `skills were verified against`;
    } else {
      let ahead = "?";
      let behind = "?";
      try {
        const counts = git(
          "rev-list",
          "--left-right",
          "--count",
          `${baseline.fyiRef}...HEAD`,
        ).split(/\s+/);
        behind = counts[0];
        ahead = counts[1];
      } catch {
        // The baseline commit is not in this checkout at all — a shallow clone,
        // or a fork. Saying so is more useful than a wrong number.
        behind = ahead = "unknown (baseline commit not in this checkout)";
      }
      drift =
        `baseline: these skills were verified against fyi ` +
        `${baseline.fyiRef.slice(0, 8)} (${baseline.verifiedAt ?? "undated"}); ` +
        `this checkout is ${headShort} (${headDate}) — ` +
        `${ahead} commit(s) newer, ${behind} commit(s) it does not have.\n` +
        `            Version-sensitive claims carry the date they became true. ` +
        `See VERSIONING.md.`;
    }
  } catch {
    drift =
      `baseline: ${fyi} is not a git checkout — cannot report drift from ` +
      `${baseline.fyiRef.slice(0, 8)}`;
  }
} else {
  note(
    `coverage.json has no "baseline" block. Every published skill set names the ` +
      `fyi commit it was verified against — see VERSIONING.md.`,
  );
}

// ---------------------------------------------------------------- skills side

const skillDirs = readdirSync(join(REPO, "skills")).filter((d) =>
  statSync(join(REPO, "skills", d)).isDirectory(),
);

for (const dir of skillDirs) {
  const skillMd = join(REPO, "skills", dir, "SKILL.md");
  if (!existsSync(skillMd)) {
    note(`skills/${dir}/ has no SKILL.md`);
    continue;
  }
  const src = readFileSync(skillMd, "utf8");
  const fm = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!fm) {
    note(`skills/${dir}/SKILL.md has no YAML frontmatter`);
    continue;
  }
  // Parse the frontmatter the way the INSTALLER does, not the way a regex
  // would. A gate that validates a different grammar from the consumer is not
  // a gate.
  const yaml = parseFrontmatter(fm[1]);
  if (yaml.error) {
    note(
      `skills/${dir}/SKILL.md frontmatter is not valid YAML: ${yaml.error}\n` +
        `      \`npx skills add\` runs a real YAML parser and SKIPS a skill it ` +
        `cannot parse, so this skill does not install at all. A description ` +
        `containing ": " must be quoted.`,
    );
    continue;
  }
  const { name, description } = yaml.value;

  if (name !== dir) {
    note(
      `skills/${dir}/SKILL.md declares name "${name}" — it must equal the ` +
        `directory name, because that is what \`--skill\` resolves.`,
    );
  }
  if (!description) {
    note(`skills/${dir}/SKILL.md has no description — it will never trigger.`);
  } else if (description.length < 80) {
    note(
      `skills/${dir}/SKILL.md description is ${description.length} chars. ` +
        `A description is the ONLY thing an agent reads when deciding whether ` +
        `to load the skill; say what it covers AND when to reach for it.`,
    );
  }

  if (!(dir in coverage.skills)) {
    note(`skills/${dir}/ has no entry in coverage.json`);
  }

  // Rule 1 of VERSIONING.md: every skill names the fyi it was verified
  // against. Enforced rather than asked for, because the whole point is that
  // it must never be the line someone forgets.
  const stamp =
    /Verified against fyi `([0-9a-f]{7,40})` \((\d{4}-\d{2}-\d{2})\)/.exec(src);
  if (!stamp) {
    note(
      `skills/${dir}/SKILL.md carries no version stamp. Add, under the title:\n` +
        "        > **Verified against fyi `<sha>` (<YYYY-MM-DD>).** …  — see VERSIONING.md",
    );
  } else if (baseline.fyiRef && !baseline.fyiRef.startsWith(stamp[1])) {
    // A stamp NEWER than the baseline is correct and expected: one skill
    // re-verified against a later fyi without re-verifying the others.
    // Requiring every stamp to equal the baseline would make a one-skill
    // correction cost a full re-verification pass — which is how you get a
    // set of rubber-stamps. So the rule is "at least the baseline".
    let descendant = false;
    try {
      execFileSync(
        "git",
        ["-C", fyi, "merge-base", "--is-ancestor", baseline.fyiRef, stamp[1]],
        { stdio: "ignore" },
      );
      descendant = true;
    } catch {
      descendant = false;
    }
    if (!descendant) {
      note(
        `skills/${dir}/SKILL.md is stamped fyi ${stamp[1]}, which is not the ` +
          `baseline (${baseline.fyiRef.slice(0, 8)}) and does not contain it. ` +
          `A stamp may be newer than the baseline — that is a skill re-verified ` +
          `on its own — but it may never be older or unrelated, because then the ` +
          `page makes claims about a tree nobody here has checked.`,
      );
    }
  }

  // Every references/*.md the SKILL.md points at must exist, and every file
  // under references/ must be reachable from SKILL.md. An unreferenced
  // reference page is a page no agent will ever open.
  const refDir = join(REPO, "skills", dir, "references");
  if (existsSync(refDir)) {
    const onDisk = readdirSync(refDir).filter((f) => f.endsWith(".md"));
    const linked = new Set(
      [...src.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]),
    );
    for (const f of onDisk) {
      if (!linked.has(f)) {
        note(`skills/${dir}/references/${f} is not linked from SKILL.md`);
      }
    }
    for (const f of linked) {
      if (!onDisk.includes(f)) {
        note(`skills/${dir}/SKILL.md links references/${f}, which is missing`);
      }
    }
  }
}

for (const skill of Object.keys(coverage.skills)) {
  if (!skillDirs.includes(skill)) {
    note(`coverage.json names skill "${skill}", which has no skills/ directory`);
  }
}

// ------------------------------------------- skills -> fyi (paths live)

for (const [skill, entry] of Object.entries(coverage.skills)) {
  for (const p of entry.covers ?? []) {
    if (!existsSync(join(fyi, p))) {
      note(
        `coverage.json: skill "${skill}" claims ${p}, which does not exist in ` +
          `${fyi}. Either the path moved (update the claim AND the skill ` +
          `prose that cites it) or the feature was deleted (drop both).`,
      );
    }
  }
}

// ------------------------------------------- fyi -> skills (docs covered)

// The three real, enumerable "one file per topic" surfaces. See adaptation
// note 3 in the header for why these, and why there is no `docs/flows/`.
const surfaces = [
  // The mkdocs tree — mkdocs.yml's own `nav` is built from it.
  { root: "docs", match: (p) => p.endsWith(".md") },
  // One manifest per component, plus whatever READMEs exist. The MANIFEST is
  // the load-bearing half: `vym-fyi-healthcheck` and `vym-fyi-node` have no
  // README, so a README-keyed surface would not see them at all.
  {
    root: "crates",
    match: (p) => p.endsWith("/Cargo.toml") || p.endsWith(".md"),
  },
  // One chart per deployable service. A chart is a thing the system does,
  // and it is the easiest kind of thing to add without anyone writing a
  // briefing for it.
  { root: "charts", match: (p) => p.endsWith("/Chart.yaml") },
];

const walk = (dir, prefix) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name), `${prefix}/${e.name}`)
      : [`${prefix}/${e.name}`],
  );

const docs = [];
const rootOf = new Map(); // doc path -> the surface root it was found under
for (const surface of surfaces) {
  const abs = join(fyi, surface.root);
  if (!existsSync(abs)) {
    note(
      `${fyi}/${surface.root} does not exist. This gate's fyi -> skills ` +
        `direction has nothing to check under it — either fyi ` +
        `reorganised (update tools/verify-coverage.mjs's \`surfaces\` list to ` +
        `match) or the checkout is wrong.`,
    );
    continue;
  }
  for (const f of walk(abs, surface.root).filter(surface.match)) {
    docs.push(f);
    rootOf.set(f, surface.root);
  }
}
docs.sort();

const claimed = new Set(
  Object.values(coverage.skills).flatMap((e) => e.covers ?? []),
);
const exempt = new Set(coverage.exempt ?? []);

const existedAtBaseline = (path) => {
  if (!baseline.fyiRef) return true; // no baseline: the gate already said so
  try {
    execFileSync(
      "git",
      ["-C", fyi, "cat-file", "-e", `${baseline.fyiRef}:${path}`],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false; // absent at baseline, or the commit is not in this checkout
  }
};

// Ancestor directories of `doc`, nearest first, stopping STRICTLY BELOW the
// surface root — so `crates/vym-fyi-model` is a claimable directory but
// bare `crates` is not, and `charts/vym-fyi-server-crud` is but bare
// `charts` is not. See adaptation note 4. A surface-root claim would make every file under it pass regardless
// of whether any skill's prose ever mentioned it, which is the failure vsms
// removed two entries for.
function ancestors(doc) {
  const rootDepth = (rootOf.get(doc) ?? "").split("/").length;
  const parts = doc.split("/");
  const out = [];
  for (let end = parts.length - 1; end > rootDepth; end--) {
    out.push(parts.slice(0, end).join("/"));
  }
  return out;
}

// A doc is covered when: the exact path is claimed, or it is exempted, or one
// of its ancestor directories is claimed AND the page already existed at the
// baseline commit. That last clause is what makes a directory-level claim
// honest over time: the claim covers what was there when someone verified it,
// not whatever gets added afterward with nobody re-reading it.
function covers(doc) {
  if (claimed.has(doc) || exempt.has(doc)) return true;
  for (const dir of ancestors(doc)) {
    if (claimed.has(dir)) return existedAtBaseline(doc);
  }
  return false;
}

for (const doc of docs) {
  if (!covers(doc)) {
    const inherited = ancestors(doc).some((d) => claimed.has(d));
    note(
      inherited
        ? `${doc} was added to fyi AFTER the baseline ` +
            `(${baseline.fyiRefShort ?? baseline.fyiRef?.slice(0, 8)}).\n` +
            `      Its directory is claimed, but that claim was earned against a ` +
            `tree that did not contain this page. Read it, fold it into the ` +
            `owning skill, and claim the page explicitly — or exempt it with a ` +
            `reason.`
        : `${doc} is a fyi documentation page that no skill covers.\n` +
            `      Add it — or the directory it sits in — to a skill's "covers" ` +
            `in coverage.json, and write the prose that earns the claim. If it ` +
            `genuinely needs no skill, list it under "exempt" with a reason in ` +
            `"exemptReasons".`,
    );
  }
}

for (const e of exempt) {
  if (!docs.includes(e) && !existsSync(join(fyi, e))) {
    note(`coverage.json exempts ${e}, which no longer exists in fyi`);
  }
  if (!coverage.exemptReasons?.[e]) {
    note(`coverage.json exempts ${e} with no reason in "exemptReasons"`);
  }
}

// ------------------------------------------------------------------ the report

if (failures.length > 0) {
  console.error(`\nverify-coverage: ${failures.length} gap(s)\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  // Drift is printed on failure too, deliberately: "these skills are newer than
  // the tree you pointed me at" explains most of the gaps above when someone
  // runs this against an older fyi.
  if (drift) console.error(`\n  ${drift}`);
  console.error(
    `\nThis gate is the docs↔skills parity rule. A fyi feature that ships ` +
      `without a skill is a feature every agent will get wrong.\n`,
  );
  process.exit(1);
}

console.log(
  `verify-coverage: ${skillDirs.length} skills, ` +
    `${claimed.size} fyi paths claimed, ` +
    `${docs.length} documentation pages across ${surfaces.length} surfaces, ` +
    `${exempt.size} exempt — parity against ${fyi}`,
);
if (drift) console.log(`            ${drift}`);
