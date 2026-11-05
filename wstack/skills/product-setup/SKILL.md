---
name: product-setup
description: >
  Set up /product in a repo: detect where current behavior, users, data and
  claims live, ask one section at a time, and write REQUIREMENTS.md plus a
  pointer line in AGENTS.md or CLAUDE.md. Safe to re-run: a configured repo
  whose answers have not changed is left as it is. Use for /product-setup,
  "set up product mode", or when /product finds no REQUIREMENTS.md.
---

# product-setup

Writes the profile whose contract is `${CLAUDE_PLUGIN_ROOT}/skills/product/references/profile.md`. Read it in full first. Nothing is written outside this repo, and nothing per person.

## 1. Detect

Read, without asking:

- `AGENTS.md`, or `CLAUDE.md` when there is no `AGENTS.md`: what the repo is, the product facts folder it names, the commands it lists.
- A facts folder: one with a `README.md` and files with frontmatter. Its README names the check and placeholder commands.
- `REVIEW.md` and `reviews/`: the repo's own review angles, as a hint for `requirements/`.
- `DESIGN.md`, brand or style guides: a hint for BRAND.
- Pages with SEO frontmatter (`title`, `description`) or a sitemap: a hint for SEO.
- Frontmatter in pages that cites facts of another repo: a hint for `claimsAgainst`, and the name of the key.
- `.mcp.json` and the connected tools (`ToolSearch`): a database or analytics tool for `blast`.
- `git remote get-url origin`: this repo's `owner/repo`.
- An existing `REQUIREMENTS.md`: its JSON block is the default for every answer.

## 2. Ask, one section at a time

One `AskUserQuestion` per section, recommended answer first, from what you detected. Without `AskUserQuestion`, ask the sections as text, end the turn, and continue on the reply. Never write before the person has answered every section you asked; a recommendation is not an answer. On a re-run, ask only a section whose detected signals differ from the profile, and say which signal changed.

1. **Kind and users**: `product` or `internal`; who the users are and the dimensions a count filters on; who owns an unknown count.
2. **Current behavior**: the facts folder, its README, check and placeholder commands, and the production branch; or code only.
3. **Linear**: the team key and the status cards land in. List the team's statuses with `list_issue_statuses` and recommend the first unstarted one whose name says analysis or spec. None → recommend the team's triage status, and say why. Never a status whose type is completed or canceled, whatever its name.
4. **Blast**: which tools may count users, and one example query per tool.
5. **Claims**: repos whose pages restate this repo's facts (`claimedBy`, with their team, page globs, cite key and claim files), and the repo this repo's pages must match (`claimsAgainst`).
6. **Angles**: the catalog angles to opt into (SEO, CLAIMS, BRAND for a content repo), standard angles to skip with a reason, and at most two own angles for `requirements/`.

## 3. Write

1. Build the JSON block from the answers. Validate it: write the candidate file to a scratch path and run `node ${CLAUDE_PLUGIN_ROOT}/skills/product/scripts/delta.mjs profile --repo <scratch dir>`. Fix errors, at most 3 times; then show them and stop.
2. Compare with the existing profile. The same JSON after `delta.mjs profile` normalizes both, and the same prose sections → write nothing, and say "REQUIREMENTS.md is up to date".
3. Otherwise write `REQUIREMENTS.md`: a one-line header that names this skill, the `## Users` and `## Blast queries` sections, then the JSON block in the key order the validator prints.
4. Own angles: write `requirements/<NAME>.md` only when it does not exist. Never overwrite one.
5. The pointer: in `AGENTS.md`, or `CLAUDE.md` when there is no `AGENTS.md`, add one line when no line names `REQUIREMENTS.md` yet: "Before filing a product requirement, run `/product`; its repo profile is `REQUIREMENTS.md`." Put it where the file lists commands or workflow. Ask before you edit it.

## 4. Report

What you wrote, line counts, the sections you asked and the ones you skipped as unchanged. Leave the commit to the person.
