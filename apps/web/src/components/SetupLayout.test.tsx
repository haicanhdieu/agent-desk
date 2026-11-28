import { render, screen, within } from '@testing-library/react';
import { setViewportWidth } from '@/test/fakeMatchMedia';
import { ShellContext } from './shellContext';
import { SetupLayout } from './SetupLayout';

const layout = (props: Partial<Parameters<typeof SetupLayout>[0]>) => (
  <SetupLayout projectName="invoicer-api" steps={[{ label: 'Add rule' }]} current={0} {...props}>
    body
  </SetupLayout>
);

describe('SetupLayout in the shell', () => {
  const steps = [{ label: 'Connect repo' }, { label: 'Add agent' }, { label: 'Add rule', optional: true }];
  let slot: HTMLElement;
  beforeEach(() => {
    slot = document.createElement('div');
    document.body.appendChild(slot);
  });
  afterEach(() => slot.remove());

  const inShell = (props: Partial<Parameters<typeof SetupLayout>[0]>, wizardSlot: HTMLElement | null = slot) => (
    <ShellContext.Provider value={{ wizardSlot, reportPageState: () => () => {} }}>
      <SetupLayout
        projectName="invoicer-api"
        steps={steps}
        current={2}
        stepLabel="Step 3 of 3, optional"
        title="Pick a rule"
        {...props}
      >
        body
      </SetupLayout>
    </ShellContext.Provider>
  );

  it('draws the stepper inside the slot and no top bar', () => {
    render(inShell({}));
    const aside = within(slot).getByRole('complementary', { name: 'Setup progress' });
    expect(within(aside).getByText('invoicer-api')).toBeInTheDocument();
    expect(within(aside).getByRole('list')).toBeInTheDocument();
    expect(within(aside).getByText(/Progress is saved/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Organization sections' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('draws no stepper while the shell has no slot', () => {
    render(inShell({}, null));
    expect(screen.queryByRole('complementary', { name: 'Setup progress' })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('draws the stepper in place, with no bar, when there is no shell provider', () => {
    render(layout({}));
    expect(screen.getByRole('complementary', { name: 'Setup progress' })).toBeInTheDocument();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('at 1440 puts the step label above the title and Exit setup in the aside, once each', () => {
    render(inShell({}));
    expect(screen.getAllByText('Step 3 of 3, optional')).toHaveLength(1);
    const exit = screen.getAllByRole('link', { name: 'Exit setup' });
    expect(exit).toHaveLength(1);
    expect(slot).toContainElement(exit[0]);
    expect(exit[0]).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('heading', { level: 1 }).previousElementSibling).toHaveTextContent('Step 3 of 3, optional');
    expect(screen.queryByRole('button', { name: /collapse|expand/i })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('uses exitHref for Exit setup', () => {
    render(inShell({ exitHref: '/somewhere' }));
    expect(screen.getByRole('link', { name: 'Exit setup' })).toHaveAttribute('href', '/somewhere');
  });

  it.each([390, 1023])('at %i a header row holds the step label and Exit setup, once each', (width) => {
    setViewportWidth(width);
    render(inShell({}));
    const label = screen.getAllByText('Step 3 of 3, optional');
    const exit = screen.getAllByRole('link', { name: 'Exit setup' });
    expect(label).toHaveLength(1);
    expect(exit).toHaveLength(1);
    expect(slot).not.toContainElement(exit[0]);
    expect(label[0].parentElement).toBe(exit[0].parentElement);
    expect(screen.getByRole('heading', { level: 1 }).previousElementSibling).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('on the Ready step at 390 the row holds only Exit setup', () => {
    setViewportWidth(390);
    render(inShell({ stepLabel: undefined, ready: 'Ready to trigger', current: 3, header: <h1>Project ready</h1> }));
    expect(screen.getAllByRole('link', { name: 'Exit setup' })).toHaveLength(1);
    expect(screen.queryByText(/Step \d+ of/)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
