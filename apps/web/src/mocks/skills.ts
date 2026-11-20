import { SKILL_TEMPLATES } from '@/features/setup/templates';
import type { Skill, SkillTemplate } from './types';

// Prototype boards: DeskSkills (list + code-build editor), Setup3 (templates).
const codeBuildBody = `---
name: code-build
description: Implement a user-story issue end to end and open a PR for review.
---

# Build a user story

You are working on the issue named in the prompt. The repo is already cloned
and checked out at \`main\`. Work only in this repository.

## Steps

1. Read the issue and every comment: \`gh issue view <n> --comments\`.
2. Create a branch \`ad/<n>-<short-slug>\` from \`main\`.
3. Implement the change. Follow \`CONTRIBUTING.md\` and existing patterns.
4. Run \`dotnet build\` and \`dotnet test\`. Fix failures before you go on.
5. Run \`dotnet format --verify-no-changes\` and fix what it reports.
6. Push, then open a PR with \`gh pr create\`. Start the body with \`Closes #<n>\`.
7. Comment \`/code-review\` on the PR. This starts the review run.

## Rules

- Never push to \`main\`.
- If the issue is ambiguous, ask in the terminal and wait for an answer.
- Keep the PR under 800 changed lines; split the work if it grows.`;

// Only code-build's source appears on the boards; the other bodies are minimal frontmatter plus the board description.
const stub = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

const qaFrontMatter = `---
name: qa-e2e
description: Exploratory QA pass with Playwright on a PR preview.
---
`;

const qaDiagram = `flowchart LR
  Explore --> Report`;

const qaRichBody = `${qaFrontMatter}
# qa-e2e

Open the PR preview and try the changed screens the way a person would.

## Checks

| Area | What to try | Done when |
| --- | --- | --- |
| Sign in | Log in and out twice | No error toast |
| Skills | Edit a skill and open Preview | The text renders |

## Flow

\`\`\`mermaid
${qaDiagram}
\`\`\`

## Not drawn

\`\`\`mermaid
this is not a diagram
\`\`\`
`;

/** Fixtures for the Preview stories and tests; \`rich\` is the qa-e2e skill's body. */
export const skillPreviewSamples = {
  rich: qaRichBody,
  table: `${qaFrontMatter}
# Table sample

| Area | What to try |
| --- | --- |
| Sign in | Log in |
`,
  diagram: `${qaFrontMatter}
# Diagram sample

\`\`\`mermaid
${qaDiagram}
\`\`\`
`,
  brokenDiagram: `${qaFrontMatter}
# Broken diagram sample

\`\`\`mermaid
this is not a diagram
\`\`\`
`,
  frontMatterOnly: qaFrontMatter,
};

/** code-build's body with step 5 reworded, a new step after it, and the "never push to main" rule removed. */
export const skillDiffDraft = codeBuildBody
  .replace(
    '5. Run `dotnet format --verify-no-changes` and fix what it reports.',
    '5. Run `dotnet format` and commit what it changes.\n6. Run the linter and fix every warning.',
  )
  .replace('6. Push, then', '7. Push, then')
  .replace('7. Comment `/code-review`', '8. Comment `/code-review`')
  .replace('- Never push to `main`.\n', '');

const lastCommit = 'a91c3e2, 2 days ago';

export const skills: Skill[] = [
  {
    name: 'code-build',
    description: 'Implement a user-story issue end to end and open a PR.',
    body: codeBuildBody,
    ruleSummary: '2 rules',
    path: '.claude/skills/code-build/SKILL.md',
    lastCommit,
  },
  {
    name: 'code-review',
    description: 'Review a PR, fix small issues, approve or request changes.',
    body: stub('code-review', 'Review a PR, fix small issues, approve or request changes.'),
    ruleSummary: '1 rule',
    path: '.claude/skills/code-review/SKILL.md',
    lastCommit,
  },
  {
    name: 'code-e2e',
    description: 'Reproduce and fix a flaky end-to-end test.',
    body: stub('code-e2e', 'Reproduce and fix a flaky end-to-end test.'),
    ruleSummary: '1 rule',
    path: '.claude/skills/code-e2e/SKILL.md',
    lastCommit,
  },
  {
    name: 'qa-e2e',
    description: 'Exploratory QA pass with Playwright on a PR preview.',
    body: skillPreviewSamples.rich,
    ruleSummary: '1 rule, off',
    path: '.claude/skills/qa-e2e/SKILL.md',
    lastCommit,
  },
];

// The template list lives with the setup flow (features/setup/templates.ts, with bodies); stories get the card text.
export const skillTemplates: SkillTemplate[] = SKILL_TEMPLATES.map(({ name, description, note }) => ({
  name,
  description,
  ...(note !== undefined && { note }),
}));
