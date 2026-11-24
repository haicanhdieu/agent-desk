# Resume messages

What you send a running agent with SendMessage. Fill the `<…>` slots and send as written.

## Analyst, each round

Every resumed analyst gets the same answers, so each sees what the others asked:

```text
Round <k> answers, from the human, word for word:
T<n> (your <area> Q<n>, if you asked it; asked by <areas>): <question>
  Answer: <answer>
…
<when triage handed a question to another area's finding:> Your Q<n> was not asked: the <other
area> analyst decided it: "<that analyst's DECIDED:, FOLLOWS: or AGENT CALLS: line>". Use it, or ask
again in your next reply if it does not hold for your area, saying why.
Other areas' findings, read them and align with them: <workdir>/areas/<each other active area>.md
Update <workdir>/areas/<area>.md, then reply in one of the shapes as before.
<You have <3 - k> round(s) of questions left. | No more questions are possible: decide what is
still open and mark it "Agent call:".>
```

## Analyst, design change

For a gate AR change, a coverage gap answered "add" or "change", or a spec gap answer. Only to the analysts whose area it touches (all of them when unsure):

```text
The human read the combined design and wants these changes, word for word: <changes>.
Dependencies answered: <name: approved | refused, one per line, or "none">.
Update <workdir>/areas/<area>.md and reply with your revised design, or with questions if the
changes open any. <You have <3 - rounds used> round(s) of questions left. | No more questions
are possible: decide what is still open and mark it "Agent call:".>
```

## Spec writer

Gate P2 yes:

```text
The human approved a UI prototype for this spec. Boards: <one path per line>. Changes the human
asked for while reviewing it, word for word: <changes, or "none">. Read the boards, edit the
spec in place so it says what they show (screens, states, copy), and set the prototype line of
"## UI and Storybook" to those boards. Keep the blocker. Reply in the same shape as before.
```

OPEN answers:

```text
The human answered the gaps you listed, word for word:
<OPEN line>: <answer>
…
The area files now record them. Edit the spec in place. Reply in the same shape as before.
```

Coverage gaps:

```text
A check against the requirement found parts the spec did not cover. The human decided, word for
word:
<the requirement's words>: <answer>
…
The area files now record what the human asked to add or change. Edit the spec in place so it
says it; a part the human left out stays out. Reply in the same shape as before.
```

Design changed:

```text
The human changed the confirmed design at gate AR. The area files that changed:
<workdir>/areas/<area>.md, one per line. The change, word for word: <changes>. Edit the existing
spec in place (keep its filename and line 1); write no second file. Reply in the same shape as
before.
```

Gate A changes (also a rule change at gate C):

```text
The human read the spec and wants these changes, word for word: <changes>. Edit the spec file
in place. Reply in the same shape as before.
```

## Coverage checker

```text
The spec was revised for the gaps you listed. Read <worktree>/<spec path> and
<workdir>/answers.md again and redo the check from step 1. Reply in the same shape as before.
```

## Prototyper

```text
The human reviewed the boards and wants these changes, word for word: <changes>. Change only
what they name, rebuild the interactive prototype for them (step 6), and reply in the same
shape as before.
```

## Planner

```text
The task graph check failed. Fix the tasks (their "Depends on" lines, their files, or how the
work is cut), not the check. Output, verbatim:
<output of dev-plan.mjs graph>
Reply in the same shape as before.
```

```text
The human read the plan and wants these changes, word for word: <changes>. Edit the plan file in
place, keeping task numbers where the task still holds. Reply in the same shape as before.
```
