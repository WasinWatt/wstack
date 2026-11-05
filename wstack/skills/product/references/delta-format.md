# Fact delta format

The delta says which lines of current behavior a requirement changes. Size, blast, gate angles, the duplicate search and the PR check all read it. It lives in the card as one fenced block with the info string `delta`, under `## Fact delta`. `scripts/delta.mjs` parses it from a card or from a bare delta file.

````md
```delta
base paypers-ai/paypers@3f2a1c9

fact docs/product/tags.md § ข้อจำกัด
- - ชื่อแท็กยาวไม่เกิน {{TAG_NAME_MAX_LENGTH}} ตัวอักษร ห้ามมีอีโมจิ
+ - ชื่อแท็กยาวไม่เกิน {{TAG_NAME_MAX_LENGTH}} ตัวอักษร ใส่อีโมจิได้
+ - ติดแท็กจากแชท LINE ได้วันละ {{NEW:MAX_LINE_TAGS_PER_DAY=20}} ครั้ง

const BULK_LIMITS.DOWNLOAD_RECEIPTS 20 -> 50

page paypers-ai/paypers-landing src/content/docs/guide/tag.md
> ชื่อแท็กไม่เกิน 50 ตัวอักษร ภาษาไหนก็ได้ ใส่อิโมจิได้
The name rules must match the tags fact at production.

none Users sent to the login page land back on the page they meant to open.
```
````

The examples come from one repo. The format works the same in any repo whose profile names a facts folder.

## Rows

Blank lines separate rows. A line that starts with `#` is a comment. The first line may be `base <owner/repo>@<sha>`: the commit the `-` and `>` lines were read at.

| Row | Header | Body | Kind |
| --- | --- | --- | --- |
| `fact` | `fact <path> [§ <section>]` | `- ` lines whose text after the marker is a fact line copied verbatim (a bullet line reads `- - text`) from the fact at `base`, then `+ ` lines that replace them. No `-` lines: the `+` lines go at the end of the section, which is then required. A path that does not exist yet: the `+` lines are the whole new file. | behavior |
| `const` | `const <KEY> <old> -> <new>` | none | limit |
| `page` | `page <owner/repo \| .> <path>` | optional `> ` lines quoted verbatim from the page, then free text on what changes | content |
| `doc` | `doc <owner/repo \| .> <path>` | as `page` | content |
| `none` | `none <the behavior in one line>` | optional free text | behavior |

- A repo whose profile sets `"kind": "internal"` makes every row **internal**.
- `.` means the repo the run is in.
- A `const` row names a key that exists in code today. A new number is a `{{NEW:KEY=value}}` token inside a `+` line. A new flag is `flag: NEW:name` in a `+` frontmatter line, or `<!-- flag: NEW:name -->` in a `+` block marker.
- `none` is still a requirement. It only means no fact line describes the behavior yet.

## What each kind runs

Each angle file's header (`standard`, `kinds`) in `${CLAUDE_PLUGIN_ROOT}/skills/product-gate/angles/` holds this table, and `delta.mjs` reads the headers. The gate reads the script's output rather than this page.

| Kind | Standard angles | Catalog angles, when the target repo opts in |
| --- | --- | --- |
| behavior | WHY, WHAT, FIT, ROLLOUT | none |
| limit | WHY, WHAT, FIT, ROLLOUT | none |
| content | WHY, WHAT | CLAIMS, SEO, BRAND |
| internal | WHY, WHAT | none |

A call runs the union over its rows. The profile's `skip` removes an angle and gives the reason. A repo's own angle in `requirements/` runs when its `kinds` header lists a kind the delta holds.

## Checks

`node ${CLAUDE_PLUGIN_ROOT}/skills/product/scripts/delta.mjs report <card-or-delta> [--check]` prints one JSON report:

- `errors`: lines that do not parse, and `fact` rows that would not apply.
- per row: `stale` `-` or `>` lines that are no longer verbatim in the file, the current value and old-value mismatch of a `const` key, the fact lines that use a `const` key, and the `NEW` tokens.
- `mirrors`: lines in other facts that link to a fact a row touches.
- `claimedBy`: pages in other repos that cite a touched fact, and lines in their claim files that show a changed number.
- `angles`: the angles the gate runs, with the reason for each skip.
- `check` (with `--check`): the profile's `factCheck`, run on a scratch worktree with the `fact` rows applied and the `NEW` tokens rendered to their values.

Exit code 0 means no errors. A stale line is a finding, not an error. Re-read the line, update the row, and update `base`.
