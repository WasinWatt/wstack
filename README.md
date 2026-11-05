# wstack

Skills on trial before they move to the Paypers plugins (`paypers-ai/plugins`). One plugin, `wstack`.

## Install

```bash
claude plugin marketplace add WasinWatt/wstack
```

```bash
claude plugin install wstack@wstack
```

To try a local edit, start Claude Code with `claude --plugin-dir ./wstack`.

## Skills

| Skill | What it does |
| --- | --- |
| `/wstack:product <idea \| issue id> [--dry-run]` | Turns an idea into a checked requirement in Linear: duplicate search, size by outcomes, fact delta, blast radius, gate. Cards land in the repo's analysis status. |
| `/wstack:product-setup` | Writes the repo's `REQUIREMENTS.md` profile, one section at a time. Safe to re-run. |
| `/wstack:shape` | The interview step: outcomes, delta rows, audiences, unverified premises, in at most 5 questions. |
| `/wstack:product-gate <issue id>` | One agent per angle (WHY, WHAT, FIT, ROLLOUT, and CLAIMS, SEO, BRAND where a repo opts in). Posts a report and never changes status. |
| `/wstack:product-blast` | One query per delta row to count who a change affects, or "unknown" with an owner. |

The design and its acceptance criteria are in Linear issue PAY-3209.

## Test

```bash
node --test 'wstack/**/*.test.mjs'
```

```bash
claude plugin validate . && claude plugin validate wstack
```
