---
angle: CLAIMS
standard: false
kinds: [content]
---

# CLAIMS

Question: does every statement the touched pages make about the product match the product facts at production?

- For each `page` or `doc` row, list every statement the page makes about what the product does, its limits, prices, tiers, trial and roles, in the page as it will read after the change.
- Fetch the facts the page cites: `node ${CLAUDE_PLUGIN_ROOT}/skills/product/scripts/delta.mjs facts <page> --repo <repo>`. A page that cites none (a pricing table, an FAQ, a component) → find the facts by topic in the facts repo at the same ref. Render every placeholder the way that repo's facts README says.
- Check each statement against the rendered fact. A contradiction → `major` `fix`, quoting both, with the page `file:line` and the fact `file:line`. Report contradictions on the touched pages that the card did not cause too: they ship with this change.
- A statement no fact covers → `question` to the facts owner. Never pass it.
- A number on the page that a fact holds as a placeholder must equal the rendered value at production, not on main.
