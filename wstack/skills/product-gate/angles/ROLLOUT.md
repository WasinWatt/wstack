---
angle: ROLLOUT
standard: true
kinds: [behavior, limit]
---

# ROLLOUT

Question: who and what must change on release day besides the code, and is each one on the card?

- Every surface that tells users about this behavior: the in-product copy, the chat assistant's prompt or answers, help docs, landing pages, support macros. Look for them in the repo (grep the behavior's words and numbers) and in the report's `claimedBy`.
- Each `claimedBy` page or claim line the change makes wrong is a delta row on the card, or a line in Out of scope with the reason. A missing one → `fix`.
- Existing users: what happens to data, settings or habits made under the old behavior. A limit that goes down, or a removed option → `blocker` until the card says what happens to people already over it.
- A flag: the card says whether it rolls out behind one, and the token is `NEW:name` until the flag exists.
- Support and sales: anyone who promised the old behavior. A `question` to the owner when you cannot tell.
