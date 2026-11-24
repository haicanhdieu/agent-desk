import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { runDetails } from '@/mocks';
import { RunSidePanel } from '@/screens/RunSidePanel';
import { hostileModelName, longModelName, runUsageViews } from '@/mocks/runUsage';
import type { RunUsageView } from '@/mocks/types';
import { RunUsage } from './RunUsage';

const ESTIMATE = 'Estimate at public API rates, whatever credential the run used.';
const FIXED = 'Costs are fixed when recorded, so later price changes do not change them.';
const BILL = 'Your provider bill may differ.';
const PARTIAL = 'Some usage is missing or had no price when recorded, so tokens or cost may be low.';

function renderUsage(usage: RunUsageView, props: { initialOpen?: boolean; initialModelsOpen?: boolean } = {}) {
  return render(<RunUsage usage={usage} {...props} />);
}
const row = (term: string) => {
  const dt = screen.getByText(term, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
};
const noteText = () => screen.getByText(new RegExp(ESTIMATE)).textContent ?? '';

describe('RunUsage', () => {
  it('SingleModel: split rows, total and one model row', () => {
    renderUsage(runUsageViews.SingleModel);
    expect(screen.getByText('Total tokens', { selector: 'dt' })).toHaveTextContent('all tokens processed');
    expect(row('Total tokens')).toHaveTextContent('48,213');
    expect(row('Input (uncached)')).toHaveTextContent('6,120');
    expect(row('Cache read')).toHaveTextContent('38,400');
    expect(row('Cache write')).toHaveTextContent('2,100');
    expect(row('Output')).toHaveTextContent('1,593');
    expect(row('Est. cost')).toHaveTextContent('~$0.42');
    expect(screen.queryByText('of which reasoning')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('MultiModel: lists each model with tokens and cost', () => {
    renderUsage(runUsageViews.MultiModel);
    expect(row('Total tokens')).toHaveTextContent('58,087');
    const table = screen.getByRole('table', { name: 'Usage by model' });
    expect(within(table).getByRole('rowheader', { name: 'model-a' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'model-b' })).toBeInTheDocument();
    expect(within(table).getByText('9,874')).toBeInTheDocument();
    expect(within(table).getByText('~$0.03')).toBeInTheDocument();
  });

  it('the note appears once with the exact order and the bill sentence last', () => {
    renderUsage(runUsageViews.SinglePriceDate);
    expect(screen.getAllByText(new RegExp(ESTIMATE))).toHaveLength(1);
    expect(noteText()).toBe(`${ESTIMATE} ${FIXED} Prices as of 21 Nov 2026. ${BILL}`);
  });

  it('PriceDateRange: the date sentence names both dates', () => {
    renderUsage(runUsageViews.PriceDateRange);
    expect(noteText()).toContain('Prices as of 18 Nov 2026 to 21 Nov 2026.');
  });

  it('without a price date there is no date sentence', () => {
    const view = runUsageViews.SingleModel;
    renderUsage({ ...view, priceDate: undefined });
    expect(screen.queryByText(/Prices as of/)).toBeNull();
    expect(noteText()).toBe(`${ESTIMATE} ${FIXED} ${BILL}`);
  });

  it('Partial: at least before the cost and the partial note', () => {
    renderUsage(runUsageViews.Partial);
    expect(row('Est. cost')).toHaveTextContent('at least ~$42.89');
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
  });

  it('a run without partial has no partial note', () => {
    renderUsage(runUsageViews.SingleModel);
    expect(screen.queryByText(PARTIAL)).toBeNull();
  });

  it('UnpricedModel: the unpriced cost is a dash with a title', () => {
    renderUsage(runUsageViews.UnpricedModel);
    const dash = within(screen.getByRole('table')).getByTitle('No price when this was recorded');
    expect(dash).toHaveTextContent('—');
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
  });

  it('WithReasoning: shows the of-which-reasoning line', () => {
    renderUsage(runUsageViews.WithReasoning);
    expect(screen.getByText('of which reasoning').parentElement).toHaveTextContent('640');
  });

  it('NoUsage: no toggle and a plain sentence', () => {
    renderUsage(runUsageViews.NoUsage);
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('No usage data for this run.')).toBeInTheDocument();
  });

  it('Zero: shows 0 rows and ~$0.00 with the dated note', () => {
    renderUsage(runUsageViews.Zero);
    expect(row('Total tokens')).toHaveTextContent(/^0/);
    expect(row('Output')).toHaveTextContent('0');
    expect(row('Est. cost')).toHaveTextContent('~$0.00');
    expect(noteText()).toContain('Prices as of 21 Nov 2026.');
  });

  it('LongModelName: the name is truncated with a title', () => {
    expect(longModelName).toHaveLength(128);
    renderUsage(runUsageViews.LongModelName);
    expect(screen.getByRole('rowheader')).toHaveAttribute('title', longModelName);
  });

  it('HostileModelName: renders as text, never as an element', () => {
    const { container } = renderUsage(runUsageViews.HostileModelName);
    expect(container.querySelector('img')).toBeNull();
    const header = screen.getByRole('rowheader');
    expect(header).toHaveTextContent(hostileModelName);
    expect(header).toHaveAttribute('title', hostileModelName);
  });

  it('table has a caption, column headers and row headers', () => {
    renderUsage(runUsageViews.MultiModel);
    const table = screen.getByRole('table', { name: 'Usage by model' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Model', 'Tokens', 'Est. cost']);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2);
  });

  it('Collapsed: Hide leaves the header, Show brings the body back, a remount starts open', async () => {
    const user = userEvent.setup();
    const { unmount } = renderUsage(runUsageViews.Collapsed);
    const button = screen.getAllByRole('button', { name: 'Hide' })[0] as HTMLElement;
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const regionId = button.getAttribute('aria-controls') ?? '';
    await user.click(button);
    const show = screen.getByRole('button', { name: 'Show' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', regionId);
    expect(document.getElementById(regionId)).not.toBeVisible();
    expect(screen.queryByRole('region', { name: 'Usage' })).toBeNull();
    expect(screen.getByText('Usage')).toBeVisible();
    await user.click(show);
    expect(screen.getByRole('region', { name: 'Usage' })).toHaveAttribute('id', regionId);
    expect(screen.getByText('Total tokens', { selector: 'dt' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Hide' })[0] as HTMLElement);
    unmount();
    renderUsage(runUsageViews.Collapsed);
    expect(screen.getByRole('region', { name: 'Usage' })).toBeVisible();
  });

  it('initialOpen false starts collapsed', () => {
    renderUsage(runUsageViews.Collapsed, { initialOpen: false });
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Usage' })).toBeNull();
  });

  it('ModelsCollapsed: Hide on Models hides only the table', async () => {
    const user = userEvent.setup();
    renderUsage(runUsageViews.ModelsCollapsed);
    const [, models] = screen.getAllByRole('button', { name: 'Hide' }) as HTMLElement[];
    const table = screen.getByRole('table', { name: 'Usage by model' });
    expect(models).toHaveAttribute('aria-controls', table.id);
    await user.click(models as HTMLElement);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
    expect(row('Total tokens')).toBeVisible();
    expect(row('Est. cost')).toBeVisible();
    expect(noteText()).toContain(BILL);
  });

  it('initialModelsOpen false starts with the table hidden', () => {
    renderUsage(runUsageViews.ModelsCollapsed, { initialModelsOpen: false });
    expect(screen.queryByRole('table')).toBeNull();
    expect(row('Total tokens')).toBeVisible();
  });
});

describe('RunSidePanel placement', () => {
  const data = { ...runDetails.RunSucceeded, usage: runUsageViews.SingleModel };
  it('renders the Usage section directly before the chain', () => {
    render(<RunSidePanel data={data} />);
    const usage = screen.getByRole('region', { name: 'Usage' }).closest('section') as HTMLElement;
    expect(usage.nextElementSibling).toHaveTextContent('Chain on this ticket');
  });
  it('passes the collapsed flags through', () => {
    render(<RunSidePanel data={{ ...data, usageCollapsed: true }} />);
    const usage = screen.getByText('Usage').closest('section') as HTMLElement;
    expect(within(usage).getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Usage' })).toBeNull();
  });
  it('renders no Usage section when the run has none', () => {
    render(<RunSidePanel data={{ ...runDetails.RunSucceeded, usage: undefined }} />);
    expect(screen.queryByText('Usage')).toBeNull();
  });
});
