# Clustering the rules

How to add `clusters` to `scope.json` (shape in [schemas.md](../schemas.md)). A cluster is one GitHub sub-issue, one case writer and one case reviewer, so its size sets both the cost of the run and how readable each issue is.

## Size

- **1 to 8 rules** per cluster; `validate.mjs` rejects more than 8.
- **Aim for 3 to 6 rules, or about 10 to 25 expected cases.** A `validation` or `permission` rule with bounds or roles yields 3 to 6 cases; a `navigation` or `side-effect` rule usually 1 to 3. Weigh by that, not by rule count alone.
- A cluster of 1 rule is fine when the rule shares nothing with the others (its own screen, its own flow) or is large on its own. Do not pad it with unrelated rules to reach a number.
- A scope of 1 to 4 rules is one cluster.

## How to group

Group by what a tester would set up once and then exercise: the same screen, the same flow, the same entity. In order of preference:

1. **The same screen or step** (step 2 of setup, the plugin form): the cases share preconditions, and the writer reads one source section.
2. **The same flow across screens** (create, then edit, then delete a plugin).
3. **The same entity or concern** (every rule about connection limits).

Keep together the rules most likely to produce overlapping cases, such as `validation` and `feedback-state` on the same form, so one writer and one reviewer see both and nothing is written twice. Do not group by category across screens ("all permission rules"): the cases share nothing to set up, and the writer has to read every section.

Order clusters as a user meets them (setup before settings), and rules inside a cluster in rule-id order.

## Fields

- `id`: `CL-01`, `CL-02`, …
- `title`: what the cluster covers, in the user's words: "Step 2: choosing a repository". At most 80 characters, no id.
- `summary`: one sentence naming the screen or flow and what the rules decide there.

## Re-runs

`publish.mjs existing <slug>` lists the published clusters and their rules. A cluster whose rules are mostly unchanged keeps its id and title, so its issue is updated rather than replaced. Moving a rule between clusters is fine; its case ids and ticked boxes follow it. New clusters take the next free number; never reuse the id of a cluster that is gone.

## Before you hand over

Run `validate.mjs <workdir> clusters` and fix every error: each rule in exactly one cluster, no unknown ids, no cluster over 8.
