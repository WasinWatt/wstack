<!-- An epic: the parent issue of 2 or more outcomes. Each child uses issue.md. -->

## Goal

<who> can now <do X>.

Success signal: <one measurable sign the whole epic worked, and where it is measured>.

## Why

<The problem, then its evidence.>

## Impact

<Audience predicate> → <count> (<query or source>)

## Approach

1. <3–6 numbered decisions: contracts, data, flag. No code.>

## Children

| # | Issue | Outcome | Blocked by | Verify |
| --- | --- | --- | --- | --- |
| 1 | <id> | <who> can now <do X> | none | <the child's end-to-end check> |

### Order of work

Each column can run in parallel. An arrow is an output the next card waits on.

```mermaid
graph LR
  subgraph w1["1 · Start now, in parallel"]
    n_A["<b><id></b><br/><outcome>"]
  end
  subgraph w2["2 · Then"]
    n_B["<b><id></b><br/><outcome>"]
  end
  subgraph wdone["3 · Done when"]
    done["<the Epic done when check, one line>"]
  end
  n_A -->|"<what B needs from A>"| n_B
  n_B -.-> done
```

```text
1 · Start now: <id>
2 · Then: <id> (needs <what> from <id>)
3 · Done when: <the check>
```

<!-- Printed by scripts/order.mjs from the children's native blocked-by relations. Never draw it by hand. Drop the graph when the profile or a test showed Linear does not render it. -->

## Epic done when

<One end-to-end check across all children.>

## Fact delta

```delta
<the union of the children's rows>
```

## Out of scope

- <What this won't touch.>
- Later: <an outcome nobody commits to now>

## Risks

- <A risk and what limits it.>

## Open

- <An unverified premise or question> · <owner>
