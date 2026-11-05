# wstack

Trial skills for Paypers repos, before they move to `paypers-ai/plugins`. Follow that repo's rules so the move is a copy: a skill holds no repo paths, product terms or business rules. They belong in the consuming repo's profile (`REQUIREMENTS.md` for `/product`), read at run time.

- `wstack/skills/<name>/SKILL.md`: frontmatter `name` and `description`, then the steps. `references/` for detail a step loads. `scripts/` for code, each with a `.test.mjs` next to it.
- Run a bundled script as `${CLAUDE_PLUGIN_ROOT}/skills/<name>/scripts/...`.
- No `version` in any manifest.

## Test

- `node --test 'wstack/**/*.test.mjs'`
- `claude plugin validate .` and `claude plugin validate wstack`
- A behavior change carries a recorded run: add the case to `trials/cases.md` with its expected result before the run, and the outcome to `trials/results.md` after it. `trials/` is gitignored: it names private repos and production data, so it never goes into this public repo.
