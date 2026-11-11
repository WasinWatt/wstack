# wstack

i'm [wasin](https://github.com/WasinWatt). wstack is where i trial skills before they move into my team's shared plugins. right now it holds one: `/product`.

most product ideas reach a dev half-finished. the dev picks up the ticket and finds it already exists under another name. or the premise is wrong ("today the app asks for the card twice", and it doesn't). or nobody knows who it's for, or how many people it touches. and nobody remembers that the pricing page still states the old number. the ticket goes back, and a week is gone.

**`/product` is my answer.** you type an idea in your own words. it does the legwork a careful PM would, then files a card a dev can start from without coming back to ask.

**it reads what you mean before it writes what you said.** it says back the outcome you want, the problem behind it and the smallest change that would get it. then it routes: a clear idea goes straight to a card. an idea with no stated problem, or with a cheaper way to the same outcome, gets one challenge round: what happened that made this needed, and here are the other ways, pick one. a foggy idea goes to `/grilling` first. it can say "this doesn't earn its place".

**it looks things up instead of asking.** it reads the code, your product docs and your data. it asks you at most five questions, and only what you decide: why, then what, then how.

**every claim gets checked.** before the card lands, a fresh agent reviews it from each angle, citing code or data for every finding. a premise nobody could verify stays marked unverified, with an owner. it never passes silently.

**it counts who it hits.** "pro owners who downloaded more than 20 files last month → 312", not "some users".

## what it unblocks

| without it | with `/product` |
|---|---|
| the same idea gets filed twice | it searches open issues first. if one matches, the first question is "extend that one instead?" |
| a card for the wrong thing: nobody asked why, or what else would work | it reads the intent first and challenges once: the problem and its case, then the other ways to the outcome with a recommendation |
| QA finds the hole ("a note field" with no length limit) | every input, action, state and number a card adds gets its edges, copied from the nearest thing the product already has |
| the dev comes back with questions | every card has a one-line goal, given / when / then acceptance rows with a way to verify each, and an out-of-scope list |
| the ticket rests on a wrong premise | the FIT angle checks every "today X happens" against the code and cites the line |
| "how many users is this?" | one query per change through your database or analytics tools, or "unknown" plus the person who can find out |
| docs and landing pages go stale | the card lists every product-doc line and page that changes. a page in another repo gets its own card for that team |
| one giant ticket for everything | it sizes by outcomes: one issue, an epic with one child per outcome, or a project |
| a bug hidden inside a feature request | it splits the bug off so it goes through your bug flow |

## install

in claude code:

```bash
/plugin marketplace add WasinWatt/wstack
/plugin install wstack@wstack
```

claude code leaves auto-update off for third-party marketplaces. to pull the latest once, run `claude plugin marketplace update wstack`. to turn auto-update on, run `/plugin`, open the **marketplaces** tab, select `wstack`, and choose **enable auto-update**.

you need:

- **node 20 or newer.** the skills run a small checker script, [`delta.mjs`](./wstack/skills/product/scripts/delta.mjs).
- **the linear connector.** without it every run is a dry run, and the cards are written to a file instead.
- **optional: a database or analytics tool** connected to claude code (an MCP server), so it can count users. without one, every count says "unknown" and names who to ask.

## get started

two steps:

1. in your repo, run [`/wstack:product-setup`](./wstack/skills/product-setup/SKILL.md). it reads the repo, then asks six short sections: who your users are, where current behavior is written down, which linear team and status cards land in, which tools can count users, which other repos restate your docs, and any extra review angles. it writes `REQUIREMENTS.md` at the repo root. commit it, so everyone on the team runs with the same answers.
2. run [`/wstack:product`](./wstack/skills/product/SKILL.md) with your idea.

try it with `--dry-run` first. it does every step but writes the cards to a file instead of linear.

## usage

```
/wstack:product raise the bulk download limit from 20 to 50 files
```

```
/wstack:product category budgets: owners set a monthly budget per category, get a warning at 80%,
and see budget vs actual on the dashboard
```

```
/wstack:product ENG-123
```

passing an issue id rewrites that rough card in place instead of filing a new one. the original request is kept at the bottom.

when invoked it:

1. **searches for a duplicate** before asking anything.
2. **reads the intent and routes.** it says back the outcome, the problem and the smallest change. a bug goes to your bug flow, never into the requirement. something the product already does stops there. a foggy idea is grilled. an idea with no problem behind it, or a cheaper way, gets one challenge round. a clear one goes on.
3. **shapes the idea**: its outcomes, what changes in the product, who each change affects, and the edges a tester would ask about. at most five questions for the whole run.
4. **checks the change** against the real files: every line it says will change must exist today, word for word.
5. **counts who it affects**, one query per change.
6. **gates the draft** with one agent per angle, then applies their fixes once.
7. **asks you to confirm once**, then writes to linear in your analysis status, with the gate report as a comment. it never moves a card further than that.

<details>
<summary>what a card looks like</summary>

| section | holds |
|---|---|
| Goal | "<who> can now <do X>", one per outcome |
| Why | the problem and its evidence: a customer ask, a data point, a linked issue |
| Impact | who it affects and how many, with the query, or "unknown" with an owner |
| How | 3 to 7 one-line steps that name the entry points, never a file-by-file task list |
| Fact delta | the exact lines of current behavior that change (see below) |
| Acceptance | given / when / then rows, each with a command, screen or query that proves it |
| Out of scope | what a dev might assume is in, and isn't |
| Open | unverified premises and open questions, each with an owner |

an epic gets a parent card plus one whole card per outcome, linked with blocked-by in the order they ship. templates: [`templates/`](./wstack/skills/product/templates/).

</details>

<details>
<summary>the fact delta</summary>

the fact delta is the heart of a card. it says which lines of current behavior change, in a block the checker can read:

````md
```delta
fact docs/product/tags.md § Limits
- - Tag names can't contain emoji
+ - Tag names can contain emoji

const MAX_TAGS_PER_BUSINESS 20 -> 50

page acme/landing src/pages/pricing.md
> Up to 20 tags per business
The tag limit must match the product.

none Users sent to the login page land back on the page they meant to open.
```
````

- `fact`: a line in your product docs, removed (`-`) and added (`+`).
- `const`: a number in code that changes.
- `page` / `doc`: a page that restates the product, in this repo or another.
- `none`: a change no doc describes yet.

no product docs? it still works. `/wstack:product-setup` sets the repo to read behavior from code, and every premise then cites a `file:line` or is marked unverified. full format: [`delta-format.md`](./wstack/skills/product/references/delta-format.md).

</details>

## skills

`/wstack:product` runs the others for you. call one directly when you want just that step on an existing card.

| skill | use it when |
|---|---|
| [`/wstack:product`](./wstack/skills/product/SKILL.md) | you have an idea, or a rough issue, and want a card a dev can start from. |
| [`/wstack:product-setup`](./wstack/skills/product-setup/SKILL.md) | first time in a repo, or when your team, tools or docs move. safe to re-run: if nothing changed, it writes nothing. |
| [`/wstack:shape`](./wstack/skills/shape/SKILL.md) | you want to reshape an existing card's outcomes and fact delta. |
| [`/wstack:product-gate`](./wstack/skills/product-gate/SKILL.md) | you want an existing card reviewed. `/wstack:product-gate ENG-123` posts a report and never changes its status. |
| [`/wstack:product-blast`](./wstack/skills/product-blast/SKILL.md) | you want the user counts on an existing card redone. |

<details>
<summary>the gate angles</summary>

| angle | asks | runs |
|---|---|---|
| [WHY](./wstack/skills/product-gate/angles/WHY.md) | is there a real problem, for real people, with evidence? | always |
| [WHAT](./wstack/skills/product-gate/angles/WHAT.md) | can a dev start without coming back to ask? | always |
| [FIT](./wstack/skills/product-gate/angles/FIT.md) | does it contradict the product, rest on a false premise, or collide with work in flight? | behavior and limit changes |
| [ROLLOUT](./wstack/skills/product-gate/angles/ROLLOUT.md) | who else must change on release day, and what happens to existing users? | behavior and limit changes |
| [CLAIMS](./wstack/skills/product-gate/angles/CLAIMS.md) | does every page match the product as it runs in production? | content repos that opt in |
| [SEO](./wstack/skills/product-gate/angles/SEO.md) | will the page still be found, with nothing broken that search already indexes? | content repos that opt in |
| [BRAND](./wstack/skills/product-gate/angles/BRAND.md) | does the copy sound and look like the rest of the product? | content repos that opt in |

your repo can add up to two angles of its own in `requirements/<NAME>.md`, for risks only your domain has (money, privacy, compliance).

</details>

## the repo profile

everything repo-specific lives in `REQUIREMENTS.md`, not in the skills: who your users are, where behavior is written, your linear team and landing status, which tools can count users, and which other repos restate your docs. that's what lets the same skills work in an app repo, a landing-page repo or an internal tooling repo.

`/wstack:product-setup` writes it for you. the full contract: [`profile.md`](./wstack/skills/product/references/profile.md).

## not shipped here

`/product` points to two skills it doesn't bundle:

- `/grilling`, for an idea too foggy to state as an outcome. when it is installed, `/product` runs it for you, and once you confirm the shared understanding it carries straight on to the card. without it, `/product` asks its own challenge round. an idea still foggy after either becomes a `needs-info` card: its open questions each name an owner, and its next step is grilling (when it did not run) or the owners' answers (when it did). it ships in [mattpocock/skills](https://github.com/mattpocock/skills).
- `pp-dev:fix`, my team's bug flow. it's private, so when `/product` names it, file the bug your usual way.

## develop

```bash
node --test 'wstack/**/*.test.mjs'
```

```bash
claude plugin validate . && claude plugin validate wstack
```

to try a local edit, start claude code with `claude --plugin-dir ./wstack`.
