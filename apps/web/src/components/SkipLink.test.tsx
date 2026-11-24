import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SkipLink } from './SkipLink';

describe('SkipLink', () => {
  it('is a link named "Skip to main content"', () => {
    render(<SkipLink />);
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main');
  });

  it('moves focus to main on activation', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink />
        <main>
          <h1>x</h1>
        </main>
      </>,
    );
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const main = screen.getByRole('main');
    expect(main).toHaveFocus();
    expect(main.tabIndex).toBe(-1);
  });

  it('does nothing when the page has no main', async () => {
    const user = userEvent.setup();
    render(<SkipLink />);
    await user.tab();
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    await user.keyboard('{Enter}');
    expect(link).toHaveFocus();
  });
});
