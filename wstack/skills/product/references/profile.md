# REQUIREMENTS.md profile

A repo opts into `/product` with `REQUIREMENTS.md` at its root, next to an optional `requirements/` folder of its own angles. This mirrors `REVIEW.md` and `reviews/`. `/product-setup` writes both. The skills read the file from the working tree.

The file is prose plus exactly one ` ```json ` block. The JSON block is the source of truth for every key below. The prose holds only what JSON cannot: the `## Users` and `## Blast queries` sections.

## JSON keys

Written in this order. `delta.mjs profile` validates the block and prints it in this order.

| Key | Required | Value |
| --- | --- | --- |
| `kind` | yes | `product`, or `internal` for a repo whose users are the team (CI, back office, skills). Internal makes every delta row internal. |
| `team` | yes | The Linear team key cards land in. |
| `states` | yes | `{ "land": "<status>" }`: the status every created card lands in. |
| `behavior` | yes | Where current behavior is written. `{ "facts": "<dir>", "readme": "<file>", "placeholders": "<command>", "prodRef": "<branch>" }` for a facts folder, or `{ "code": true }` when only the code says it. `placeholders` prints the constant values as JSON and takes `--ref <git-ref>`. `prodRef` is the branch production runs. |
| `factCheck` | no | The command that checks fact files, run from the repo root. Absent: no fact check, and the report says so. |
| `claimsAgainst` | no | `"<owner/repo>"`: the repo whose facts this repo's pages must match, read at that repo's `behavior.prodRef`. |
| `claimedBy` | no | `[{ "repo": "<owner/repo>", "team": "<key>", "pages": ["<glob>"], "factsKey": "<frontmatter key>", "claims": ["<glob>"] }]`: repos whose pages restate this repo's facts. `pages` lists the pages, `factsKey` names the frontmatter list where a page cites facts, and `claims` lists files that state numbers without citing (pricing tables, FAQ data). A satellite card goes to `team`. |
| `blast` | no | `[{ "tool": "<ToolSearch query>", "counts": "<what it can count>" }]`: the tools `/product-blast` may query, each named by words that find it with `ToolSearch`, since a connector's tool name differs per person. Absent: every count is unknown. |
| `angles` | no | Catalog angles this repo opts into: any of `SEO`, `CLAIMS`, `BRAND`. |
| `skip` | no | `{ "<ANGLE>": "<reason>" }`: standard angles this repo never runs. |
| `size` | no | `{ "epicMax": <n> }`: the most outcomes an epic holds before it becomes a project. Default 6. |

## Prose sections

- `## Users`: who uses the product, in the words cards use. Name the audience dimensions a predicate can filter on (tier, role, surface, plan state) and the person who owns a count nobody can query.
- `## Blast queries`: for each `blast` tool, where the schema or event catalog lives and one example query. `/product-blast` adapts the example rather than writing a query from nothing.

## Other repos

A key that names another repo (`claimsAgainst`, `claimedBy`) is resolved to a local checkout in this order: a path in `PRODUCT_REPO_PATHS` (colon-separated) whose `origin` is that repo, then a sibling folder of this repo whose `origin` matches, then a blob-less clone under `~/.cache/wstack/repos/`. That repo's own `REQUIREMENTS.md` answers questions about it, such as where its facts live. A command from that file (`behavior.placeholders`) runs only in a checkout you already have, from `PRODUCT_REPO_PATHS` or a sibling folder, never in the cache clone, which is read with `git show` only.

## Own angles

`requirements/<NAME>.md`, at most two. Frontmatter `angle: <NAME>` and `kinds: [<kind>, ...]`, then the angle's question and checks, in the format of the shared catalog in `${CLAUDE_PLUGIN_ROOT}/skills/product-gate/angles/`.

## Example

```json
{
  "kind": "product",
  "team": "PAY",
  "states": { "land": "In Analysis" },
  "behavior": {
    "facts": "docs/product",
    "readme": "docs/product/README.md",
    "placeholders": "pnpm dlx tsx scripts/product-facts/export-placeholders.ts",
    "prodRef": "prod"
  },
  "factCheck": "pnpm dlx tsx scripts/product-facts/check.ts",
  "claimedBy": [
    {
      "repo": "paypers-ai/paypers-landing",
      "team": "GRO",
      "pages": ["src/content/docs/**/*.md", "src/content/docs/**/*.mdx"],
      "factsKey": "facts",
      "claims": ["src/components/Pricing*.tsx", "src/components/FAQ.tsx"]
    }
  ],
  "blast": [{ "tool": "paypers-prod query", "counts": "users, businesses and records in the production database" }]
}
```
