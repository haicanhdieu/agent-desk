import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, LinkProvider, Skeleton, ToastProvider, useToast } from '@/ds';
import { RuleForm } from '@/components/RuleForm';
import { SecretField } from '@/components/SecretField';
import { TriggerModeSetting } from '@/components/TriggerModeSetting';
import { Breadcrumb } from '@/components/Breadcrumb';

type Tone = 'ok' | 'warn' | 'err' | 'late' | 'off' | 'idle';

function Trigger({ tone, title, detail }: { tone: Tone; title: string; detail?: string }) {
  const toast = useToast();
  return <button onClick={() => toast.show({ tone, title, detail })}>show {title}</button>;
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('shows at most three toasts', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        {['a', 'b', 'c', 'd'].map((t) => (
          <Trigger key={t} tone="ok" title={t} />
        ))}
      </ToastProvider>,
    );
    for (const t of ['a', 'b', 'c', 'd']) await user.click(screen.getByText(`show ${t}`));
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(within(region).getAllByText(/^[a-d]$/)).toHaveLength(3);
    expect(within(region).queryByText('a')).not.toBeInTheDocument();
    expect(within(region).getByText('d')).toBeInTheDocument();
  });

  it('auto-dismisses info toasts after 5 s and keeps errors, which use role=alert', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger tone="ok" title="Saved" />
        <Trigger tone="err" title="Could not save" detail="Conflict" />
      </ToastProvider>,
    );
    await user.click(screen.getByText('show Saved'));
    await user.click(screen.getByText('show Could not save'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('alert')).toHaveTextContent('Conflict');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Could not save')).toBeInTheDocument();
  });

  it('dismisses a toast with its button', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger tone="err" title="Boom" />
      </ToastProvider>,
    );
    await user.click(screen.getByText('show Boom'));
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Boom')).not.toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('is hidden from assistive tech', () => {
    const { container } = render(
      <>
        <Skeleton variant="block" height={40} />
        <Skeleton variant="text" lines={3} />
      </>,
    );
    for (const el of Array.from(container.children)) expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(3);
  });
});

describe('LinkProvider', () => {
  function TestLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return (
      <a data-testid="custom" href={`/app${href}`} {...rest}>
        {children}
      </a>
    );
  }

  it('renders plain anchors by default', () => {
    render(<Button href="/x">Go</Button>);
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/x');
    expect(screen.queryByTestId('custom')).not.toBeInTheDocument();
  });

  it('routes Button href through the provided component', () => {
    render(
      <LinkProvider component={TestLink}>
        <Button href="/x">Go</Button>
      </LinkProvider>,
    );
    expect(screen.getByTestId('custom')).toHaveAttribute('href', '/app/x');
  });

  it('routes composite anchors through the provided component', () => {
    render(
      <LinkProvider component={TestLink}>
        <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: 'Run' }]} />
      </LinkProvider>,
    );
    expect(screen.getByTestId('custom')).toHaveAttribute('href', '/app/projects');
  });

  it('keeps external links as plain anchors', () => {
    render(
      <LinkProvider component={TestLink}>
        <Button href="https://github.com/o/r">Repo</Button>
      </LinkProvider>,
    );
    expect(screen.queryByTestId('custom')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Repo' })).toHaveAttribute('href', 'https://github.com/o/r');
  });
});

describe('form error props', () => {
  const draft = { command: 'fix', target: 'issue' as const, labels: [], skill: 's', agent: 'a', enabled: true };

  it('RuleForm marks the command input invalid and describes it with the message', () => {
    render(
      <RuleForm
        value={draft}
        skills={['s']}
        agents={['a']}
        onChange={() => {}}
        errors={{ command: 'Command already used' }}
      />,
    );
    const input = screen.getByLabelText('Command');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Command already used'));
  });

  it('RuleForm leaves other fields valid', () => {
    render(
      <RuleForm value={draft} skills={['s']} agents={['a']} onChange={() => {}} errors={{ skill: 'Skill is gone' }} />,
    );
    expect(screen.getByLabelText('Command')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Run skill')).toHaveAttribute('aria-invalid', 'true');
  });

  it('TriggerModeSetting shows its error as the group description', () => {
    render(<TriggerModeSetting mode="webhook" interval="5 min" error="Could not switch" />);
    expect(screen.getByText('Could not switch')).toBeInTheDocument();
    expect(screen.getAllByRole('radiogroup')[0]).toHaveAttribute('aria-invalid', 'true');
  });

  it('SecretField marks the token input invalid with its error', () => {
    render(<SecretField state="entering" credentialType="oauth_token" error="Token rejected" />);
    const input = screen.getByLabelText('Token');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Token rejected'));
  });
});
