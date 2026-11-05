---
name: shape
description: >
  The interview step of /product. Turns an idea into outcomes, a fact delta,
  an audience per delta row and a list of unverified premises, in at most 5
  questions. Run by /product; run it alone only to reshape an existing
  requirement's delta. Not for open-ended planning: use /grilling.
---

# shape

Called by `/product`, which owns the question budget (5 questions, then 1 confirm, for the whole run). Ask only what the person decides. Look up everything else.

## 1. Read current behavior

Read the profile's `behavior`:

- `facts` → read the folder's `readme` in full, then every fact the idea touches. Grep the folder for the idea's words in Thai and English, and follow links between facts. Render numbers with `behavior.placeholders` as the README says.
- `code: true` → read the code that decides the behavior: the route or screen, the constant, the permission check, the flag. Anything you state from it carries `file:line`.
- `claimsAgainst` set (a repo whose pages restate another repo's facts) → also, for every page the idea touches, run `node ${CLAUDE_PLUGIN_ROOT}/skills/product/scripts/delta.mjs facts <page>` and check each claim on the page against the facts it prints, rendered as that repo's facts README says. A page that cites no facts: find them by topic in that repo at the same ref. Each contradiction is a premise you found (step 2) and a `page` row, even when the idea did not ask about that line.

Done when you can say what the product does today, where the idea touches it, with a citation for each claim.

## 2. Premises

List every premise the idea rests on: "today X happens", "users ask for Y", "Z is the cause". For each, find the code line, fact line or data query that settles it.

- Cited and true → keep it, with the citation.
- Cited and false → tell the person now, with the citation. A false premise can end the idea. That is a good result, not a failure.
- No citation found → mark it **unverified**. It becomes a question to ask, or an Open line with an owner.

## 3. Outcomes

Write each outcome as one sentence: "<who> can now <do X>". A part is its own outcome only if it passes all three:

1. it ships alone;
2. it can be cut or deferred;
3. it has its own signal that it worked.

Merge any part that fails one into the outcome it serves. An outcome nobody commits to now becomes a "Later" line.

## 4. Delta rows

Write the rows in the format of `${CLAUDE_PLUGIN_ROOT}/skills/product/references/delta-format.md`:

- a changed fact line → `fact`, with the `-` line copied verbatim and the `+` line in the fact's own style; set `base` to the commit you read;
- a changed limit, price or quota that a constant holds → `const`;
- a page or doc in another repo that restates the behavior → `page` or `doc`;
- behavior no fact describes → `none`.

A new number or flag goes in a `{{NEW:KEY=value}}` or `NEW:name` token, never a bare literal.

For each row, write the audience predicate: who notices the change, in the dimensions the profile's `## Users` names ("owners on Pro with 25 or more tags"). "Everyone" is a predicate only when it is true; say why.

## 5. Ask

Only the gaps steps 1–4 left: the outcome, which rows the person wants, who it is for, an unverified premise only they can settle. Group them in one round of up to 4 questions, then at most one more. Each question is numbered, has a recommended answer from what you found, and is worded so "yes" accepts it. Skip any the conversation already settled.

When no outcome survives the questions, return foggy, with what you know and the open questions.

## Return

- outcomes, in the order they can ship, with what blocks what;
- the delta block;
- one audience predicate per row;
- premises: each with its citation, or marked unverified with an owner;
- the questions you asked, and the person's answers.
