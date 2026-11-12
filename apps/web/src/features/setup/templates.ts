import type { SkillTemplate } from '@/mocks/types';

/** A skill template offered in setup step 3: the card text and the SKILL.md committed when it is picked. */
export type SkillTemplateSource = SkillTemplate & { body: string };

const codeBuild = `---
name: code-build
description: Implement an issue on a branch, run build and tests, open a PR, then comment /code-review on it.
---

# Build an issue

You are working on the issue named in the prompt. The repo is already cloned and checked out at the default
branch. Work only in this repository.

## Steps

1. Read the issue and every comment: \`gh issue view <n> --comments\`.
2. Create a branch \`ad/<n>-<short-slug>\` from the default branch.
3. Implement the change. Follow \`CONTRIBUTING.md\` and existing patterns.
4. Run the project's build and tests. Fix failures before you go on.
5. Push, then open a PR with \`gh pr create\`. Start the body with \`Closes #<n>\`.
6. Comment \`/code-review\` on the PR. This starts the review run.

## Rules

- Never push to the default branch.
- If the issue is ambiguous, ask in the terminal and wait for an answer.
- Keep the PR under 400 changed lines; split the work if it grows.
`;

const codeReview = `---
name: code-review
description: Review a PR, fix small problems, run tests, then approve or request changes.
---

# Review a pull request

You are reviewing the pull request named in the prompt.

## Steps

1. Read the PR, its linked issue and every comment: \`gh pr view <n> --comments\`.
2. Check out the branch and read the diff: \`gh pr diff <n>\`.
3. Run the project's build and tests.
4. Fix small problems (typos, lint, a missing test) in a commit on the PR branch.
5. Approve with \`gh pr review --approve\`, or request changes with a list of what to fix.

## Rules

- Never merge.
- Keep review comments specific: file, line and what to change.
`;

export const SKILL_TEMPLATES: readonly SkillTemplateSource[] = [
  {
    name: 'code-build',
    note: 'chains to code-review',
    description: 'Implement an issue on a branch, run build and tests, open a PR, then comment /code-review on it.',
    body: codeBuild,
  },
  {
    name: 'code-review',
    description: 'Review a PR, fix small problems, run tests, then approve or request changes.',
    body: codeReview,
  },
];
