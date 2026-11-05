---
angle: FIT
standard: true
kinds: [behavior, limit]
---

# FIT

Question: does this fit the product as it is, or does it contradict a fact, rest on a false premise, or collide with work already in flight?

- Read every fact the delta touches and every line in the report's `mirrors`. A `+` line that contradicts another fact line the card does not change → `fix`: add the row or change the line.
- For each premise the card states ("today X happens"), find where the code decides it at the main branch. True → note the citation. False → `blocker` `fix` with the citation. Not found → `question`, and the premise stays unverified.
- A `const` row: every fact in its `usedBy` still reads right with the new value. A tier, price or quota change also checks the facts that state the tier rules.
- A `none` row has no fact to check against: read the code path that runs today and say what changes.
- Search open issues for the same files or constants (`list_issues` with the const key or fact title). A collision → `question` naming the other issue.
