import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { checklistSteps } from '@/mocks';
import { OnboardingChecklist } from './OnboardingChecklist';

describe('OnboardingChecklist', () => {
  it('renders an h2 and four rows with the step labels', () => {
    render(<OnboardingChecklist state={{ kind: 'ready', steps: checklistSteps.none }} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Get started' })).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Connect a code host'),
      expect.stringContaining('Create a project'),
      expect.stringContaining('Add an agent'),
      expect.stringContaining('Add a rule'),
    ]);
  });

  it('a done row shows Done and a todo row a Start link to its href', () => {
    render(<OnboardingChecklist state={{ kind: 'ready', steps: checklistSteps.partial }} />);
    const [done, , todo] = screen.getAllByRole('listitem');
    expect(within(done as HTMLElement).getByText('Done')).toBeInTheDocument();
    expect(within(done as HTMLElement).queryByRole('link')).toBeNull();
    expect(within(done as HTMLElement).getByRole('img', { name: 'Done' })).toBeInTheDocument();
    const start = within(todo as HTMLElement).getByRole('link', { name: /Start/ });
    expect(start).toHaveAttribute('href', '/o/acme/p/p1/desk/agent');
    expect(within(todo as HTMLElement).getByRole('img', { name: 'Not done' })).toBeInTheDocument();
  });

  it('loading shows skeleton rows and no steps', () => {
    const { container } = render(<OnboardingChecklist state={{ kind: 'loading' }} />);
    expect(container.querySelectorAll('[aria-busy="true"] > [aria-hidden="true"]')).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('error shows the banner with the request ID and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<OnboardingChecklist state={{ kind: 'error', requestId: 'req-42', onRetry }} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-42')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
