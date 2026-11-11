---
angle: WHAT
standard: true
kinds: [behavior, limit, content, internal]
---

# WHAT

Question: can a dev start from this card without coming back to ask what it means?

- The Goal is one sentence, "<who> can now <do X>", for each outcome. An epic has one child per outcome and no child per layer, rollout step, design, QA or docs task.
- Every Acceptance row is Given / When / Then and has a Verify entry a person can run: a command, a screen and what to see, or a query.
- How is 3–7 one-line steps that name entry points, not line numbers or a file-by-file task list.
- Out of scope says what a dev might assume is in and is not.
- Every delta row has a matching Acceptance row, and every Acceptance row traces to an outcome.
- Every input, action, state and number the card adds has its edges on the card, as a How line or an Acceptance row. An input: required or not, its length, size or format limit, what an empty or spaces-only value does, what happens over the limit. An action: who may run it, whether it can be undone, what running it twice does, what the person sees when it fails. A state: how something enters and leaves it, and what today's lists, filters and exports do with it. A number: its unit, and what happens at it and over it. A missing edge → `fix` with the value the nearest sibling in the code or facts uses, cited; no sibling → `question`.
- Two readings of one sentence → `fix`, with the reading that the facts or code support.
