---
name: product-blast
description: >
  Count who a requirement affects: one query per fact-delta row, from the
  audience predicate shape wrote, through the data tools the repo profile
  names. Returns an Impact line per row, or "unknown" with an owner. Run by
  /product; run it alone to recount an existing requirement.
---

# product-blast

Input: the delta report from `delta.mjs report`, and one audience predicate per row.

## 1. Tools

Read the profile's `blast` list and its `## Blast queries` prose. For each entry, find the tool with `ToolSearch` and its `tool` text. Not found → every row that needs it is unknown, and the Impact line says the tool is not connected.

## 2. One query per row

For each row:

1. Turn the predicate into one read-only query, adapted from the example in `## Blast queries`. Check table and column names against the schema or event catalog that section names before you run it.
2. Run it. An error → fix it once, then give up on that row.
3. Write the Impact line: `<predicate> → <count> (<the query, or the tool and filter>)`.

A row whose audience no tool can count → `<predicate> → unknown · <owner from ## Users> · <a date one week from today>`.

A fact's frontmatter (tiers, roles, surface) is an upper bound, never the count. Say so when it is all you have.

Run nothing that writes. Return counts, never rows of personal data.

## Return

One Impact line per row, and the largest count as the card's headline Impact.
