import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Transcript, isPrepend, type TranscriptItem } from './Transcript';

const item = (over: Partial<TranscriptItem> & Pick<TranscriptItem, 'key' | 'kind'>): TranscriptItem => ({
  time: '14:13',
  text: '',
  truncated: false,
  ...over,
});

describe('Transcript', () => {
  it('labels person messages You or Prompt and agent replies with the agent name and time', () => {
    render(
      <Transcript
        state="ready"
        items={[
          item({ key: 'a', kind: 'user', label: 'Prompt', time: '14:01', text: 'Review the PR' }),
          item({ key: 'b', kind: 'agent', label: 'Claude', time: '14:13', text: 'Done' }),
          item({ key: 'c', kind: 'user', label: 'You', time: '14:16', text: 'Thanks' }),
        ]}
      />,
    );
    const log = screen.getByRole('log', { name: 'Transcript of the agent conversation' });
    expect(within(log).getByText('Prompt')).toBeInTheDocument();
    expect(within(log).getByText('You')).toBeInTheDocument();
    expect(within(log).getByText('Claude')).toBeInTheDocument();
    expect(within(log).getByText('14:13')).toBeInTheDocument();
    expect(within(log).getByText('14:01')).toBeInTheDocument();
    expect(within(log).getByText('Review the PR')).toBeInTheDocument();
  });

  it('a tool step shows the tool name in bold and its summary in mono', () => {
    render(<Transcript state="ready" items={[item({ key: 't', kind: 'tool', tool: 'Bash', text: 'dotnet test' })]} />);
    const tool = screen.getByText('Bash');
    expect(tool.tagName).toBe('B');
    expect(screen.getByText('dotnet test')).toBeInTheDocument();
    expect(tool.parentElement?.querySelector('svg')).not.toBeNull();
  });

  it('notices render as centred rule lines in order', () => {
    render(
      <Transcript
        state="ready"
        items={[
          item({ key: 'n1', kind: 'notice', text: 'Conversation compacted' }),
          item({ key: 'a', kind: 'agent', label: 'Claude', text: 'Hello' }),
          item({ key: 'n2', kind: 'notice', text: 'Transcript limit reached; later messages were not saved' }),
        ]}
      />,
    );
    const log = screen.getByRole('log');
    const texts = Array.from(log.children).map((c) => c.textContent ?? '');
    expect(texts[0]).toBe('Conversation compacted');
    expect(texts[1]).toContain('Hello');
    expect(texts[2]).toBe('Transcript limit reached; later messages were not saved');
  });

  it('renders Markdown in user and agent text: headings, emphasis, lists, links, tables, inline and fenced code', () => {
    const md = [
      '# Plan',
      '',
      'Some **bold** and `inline` text with a [link](https://example.com/x).',
      '',
      '- first',
      '- second',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n');
    const { container } = render(
      <Transcript
        state="ready"
        items={[
          item({ key: 'a', kind: 'agent', label: 'Claude', text: md }),
          item({ key: 'b', kind: 'user', label: 'You', text: '## Ask\n\n1. one\n2. two' }),
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ask' })).toBeInTheDocument();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('p code')?.textContent).toBe('inline');
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toContain('const x = 1;');
    expect(container.textContent).not.toContain('**bold**');
    expect(container.textContent).not.toContain('# Plan');
  });

  it('raw HTML in transcript text never becomes elements, and images are never fetched', () => {
    const text = [
      '<script>alert(1)</script>',
      '<img src="https://evil.example/x.png" onerror="alert(1)">',
      '<a href="javascript:alert(1)" onclick="alert(1)">raw</a>',
      '',
      '![pic](https://evil.example/y.png)',
      '',
      '[bad](javascript:alert(1))',
    ].join('\n');
    const { container } = render(
      <Transcript state="ready" items={[item({ key: 'a', kind: 'agent', label: 'Claude', text })]} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror], [onclick]')).toBeNull();
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
    }
  });

  it('a truncated entry ends with … (cut)', () => {
    render(
      <Transcript
        state="ready"
        items={[
          item({ key: 'a', kind: 'agent', label: 'Claude', text: 'Long', truncated: true }),
          item({ key: 'b', kind: 'agent', label: 'Claude', text: 'Short', truncated: false }),
        ]}
      />,
    );
    expect(screen.getAllByText('… (cut)')).toHaveLength(1);
  });

  it('Show earlier messages calls onShowEarlier and is absent without hasEarlier', async () => {
    const onShowEarlier = vi.fn();
    const items = [item({ key: 'a', kind: 'agent', label: 'Claude', text: 'x' })];
    const { rerender } = render(<Transcript state="ready" items={items} hasEarlier onShowEarlier={onShowEarlier} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }));
    expect(onShowEarlier).toHaveBeenCalledTimes(1);
    rerender(<Transcript state="ready" items={items} onShowEarlier={onShowEarlier} />);
    expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull();
  });

  it('loading is busy and labelled Loading the transcript', () => {
    render(<Transcript state="loading" items={[]} />);
    const status = screen.getByRole('status', { name: 'Loading the transcript' });
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('error shows the request id line only when set, and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<Transcript state="error" items={[]} requestId="01JDK8Q3V2" onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load the transcript")).toBeInTheDocument();
    expect(screen.getByText('Request ID 01JDK8Q3V2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<Transcript state="error" items={[]} onRetry={onRetry} />);
    expect(screen.queryByText(/Request ID/)).toBeNull();
  });

  it('empty shows the heading with no body text', () => {
    const { container } = render(<Transcript state="ready" items={[]} />);
    expect(screen.getByRole('heading', { name: 'No conversation was saved for this run.' })).toBeInTheDocument();
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('isPrepend', () => {
  it('is true only when the old first item is still in the list below new items', () => {
    expect(isPrepend(['b', 'c'], ['a', 'b', 'c'])).toBe(true);
    expect(isPrepend(['b', 'c'], ['b', 'c', 'd'])).toBe(false);
    expect(isPrepend([], ['a'])).toBe(false);
  });

  it('is false when the list was replaced', () => {
    expect(isPrepend(['b', 'c'], ['x', 'y'])).toBe(false);
  });
});
