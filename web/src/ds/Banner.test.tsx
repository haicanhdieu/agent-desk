import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Banner } from './Banner';

describe('Banner', () => {
  it('has no live role by default', () => {
    const { container } = render(<Banner tone="warn" title="Heads up">Body</Banner>);
    expect(container.querySelector('[role]')).toBeNull();
    expect(container.firstElementChild).toHaveClass('banner', 'warn');
  });

  it('live="assertive" is an alert, live="polite" a status', () => {
    const { rerender } = render(<Banner tone="err" live="assertive">x</Banner>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<Banner tone="ok" live="polite">x</Banner>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('actionsPlacement="below" renders actions after the body', () => {
    render(<Banner tone="err" title="T" actions={<button>Retry</button>} actionsPlacement="below">Body</Banner>);
    const body = screen.getByText('Body');
    const btn = screen.getByRole('button', { name: 'Retry' });
    expect(body.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(btn.parentElement?.parentElement).toBe(body.parentElement);
  });

  it('flush and prominent add modifier classes', () => {
    const { container } = render(<Banner tone="late" flush prominent>x</Banner>);
    expect(container.firstElementChild).toHaveClass('flush', 'prominent');
  });
});
