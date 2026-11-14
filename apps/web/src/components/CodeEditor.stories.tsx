import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeEditor } from './CodeEditor';

const SKILL = `---
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
- Keep the PR under 400 changed lines; split the work if it grows.`;

const meta = {
  title: 'Components/CodeEditor',
  component: CodeEditor,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 760, height: 480, display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ initial, changedLines }: { initial: string; changedLines?: number[] }) {
  const [v, setV] = useState(initial);
  return <CodeEditor aria-label="SKILL.md source" value={v} onChange={setV} changedLines={changedLines} />;
}

export const CodeBuildChanged: Story = {
  args: { value: SKILL, changedLines: [17], 'aria-label': 'SKILL.md source' },
  render: () => <Controlled initial={SKILL} changedLines={[17]} />,
};
export const EmptyFile: Story = {
  args: { value: '', 'aria-label': 'SKILL.md source' },
  render: () => <Controlled initial="" />,
};
export const ReadOnly: Story = {
  args: { value: SKILL, readOnly: true, 'aria-label': 'SKILL.md source' },
};
