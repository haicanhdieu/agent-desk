import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SkillTemplatePreview } from './SkillTemplatePreview';

describe('SkillTemplatePreview', () => {
  it('BR-74: titles the dialog "{name} SKILL.md", shows the text and closes with Close', async () => {
    const onClose = vi.fn();
    render(<SkillTemplatePreview name="code-review" body="# Review a pull request" onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'code-review SKILL.md' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Review a pull request' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the pane loading state while the renderer loads', () => {
    render(<SkillTemplatePreview name="x" body="b" onClose={() => {}} load={() => new Promise(() => {})} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the preview');
  });
});
