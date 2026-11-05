---
name: product-gate
description: >
  Gate a drafted requirement before it reaches Linear: one agent per angle
  (WHY, WHAT, FIT, ROLLOUT, plus CLAIMS, SEO, BRAND and the repo's own
  angles where they apply), each citing code or data for what it finds.
  Returns fixes, questions and a report for the card. Run by /product; run it
  alone on an existing card with /product-gate <id>. Never changes a status.
---

# product-gate

Input: a drafted card (or an issue id: `get_issue`, then take its `delta` block), and its delta report. No report → write the delta block to a scratch file and run `node ${CLAUDE_PLUGIN_ROOT}/skills/product/scripts/delta.mjs report <file> --check`.

## 1. Angles

The report's `angles.run` lists the angles to run and the file that holds each one. Run exactly those. List `angles.skipped` with their reasons in the report.

## 2. One agent per angle

Start all of them in one message, one `Agent` per angle (2 to 9 agents), `subagent_type: "general-purpose"`, no `model`, so each runs on the session model. Each brief holds:

- the paths of the draft card, the delta report, the angle file, `REQUIREMENTS.md`, and the repo root;
- "Read the angle file and follow it. Read code and run read-only commands; edit nothing. Return only the JSON below."

Each agent returns:

```json
{
  "angle": "FIT",
  "verdict": "pass | fix | question",
  "findings": [
    {
      "severity": "blocker | major | minor",
      "action": "fix | question",
      "claim": "what is wrong, in one sentence",
      "evidence": "file:line, a query and its result, or 'none found'",
      "change": "the edit to the card, for action fix",
      "owner": "who answers, for action question"
    }
  ]
}
```

A finding with no evidence is a `question`, never a `fix`. An agent that fails or returns no JSON → that angle is **not run**, said in the report. Never mark it a pass.

## 3. Report

Merge the findings. Drop a duplicate across angles and keep the one with the stronger evidence. Then write the report in this shape:

```md
## Gate report

| Angle | Verdict | Findings |
| --- | --- | --- |
| FIT | fix | 1 major |

### FIT
- **major** · <claim> · <evidence> → <change or question · owner>

Skipped: ROLLOUT (<reason>).
Fact check: <the last line of the check output, or why it did not run>.
```

Return the report, the `fix` changes and the `question` lines. `/product` applies the fixes once and posts the report as a comment. The gate never changes a status.
