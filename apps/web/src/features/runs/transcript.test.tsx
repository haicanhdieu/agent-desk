import type { RunTranscriptEntryDto, RunTranscriptResponse } from '@agentdesk/contracts';
import { InfiniteQueryObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, routeHandler } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { FINAL_LOG_RECHECK_MS } from './useRunEvents';
import { runsQueries, TRANSCRIPT_PAGE_SIZE } from './queries';
import { transcriptConnection, transcriptItems, useTranscriptReload } from './transcript';
import type { TerminalArea } from './detail.map';

const org = 'alice';
const projectId = ids.project.invoicerApi;

const at = (h: number, m: number) => new Date(2026, 10, 19, h, m).toISOString();
const entry = (seq: number, over: Partial<RunTranscriptEntryDto> = {}): RunTranscriptEntryDto => ({
  seq,
  at: at(14, 13),
  kind: 'agent',
  tool: null,
  text: `message ${seq}`,
  truncated: false,
  ...over,
});
const page = (items: RunTranscriptEntryDto[], nextBefore: number | null = null): RunTranscriptResponse => ({
  items,
  nextBefore,
});

describe('transcriptItems', () => {
  it('items are oldest first across pages with You, Prompt and the agent name', () => {
    const newest = page([entry(3, { kind: 'user' }), entry(4)], 3);
    const older = page([entry(1, { kind: 'user' }), entry(2)]);
    const items = transcriptItems([newest, older], 'Claude');
    expect(items.map((i) => [i.key, i.kind, i.label])).toEqual([
      ['1', 'user', 'Prompt'],
      ['2', 'agent', 'Claude'],
      ['3', 'user', 'You'],
      ['4', 'agent', 'Claude'],
    ]);
  });

  it('Prompt only labels the lowest-seq user entry once no older page exists', () => {
    const newestOnly = page([entry(3, { kind: 'user' })], 3);
    expect(transcriptItems([newestOnly], 'Claude')[0]?.label).toBe('You');
    const both = [newestOnly, page([entry(1, { kind: 'user' }), entry(2, { kind: 'user' })])];
    expect(transcriptItems(both, 'Claude').map((i) => i.label)).toEqual(['Prompt', 'You', 'You']);
  });

  it('times are local HH:MM', () => {
    expect(transcriptItems([page([entry(1, { at: at(9, 5) })])], 'Claude')[0]?.time).toBe('09:05');
  });

  it('tool and notice items carry no label', () => {
    const items = transcriptItems(
      [page([entry(1, { kind: 'tool', tool: 'Bash', text: 'dotnet test' }), entry(2, { kind: 'notice' })])],
      'Claude',
    );
    expect(items[0]).toMatchObject({ kind: 'tool', tool: 'Bash' });
    expect(items[0]?.label).toBeUndefined();
    expect(items[1]?.label).toBeUndefined();
    expect(items[1]?.tool).toBeUndefined();
  });

  it('text loses control and bidi characters and truncated is carried', () => {
    const [item] = transcriptItems([page([entry(1, { text: 'a‮b\u0007c', truncated: true })])], 'Claude');
    expect(item).toMatchObject({ text: 'abc', truncated: true });
  });
});

describe('transcriptConnection', () => {
  it('gives Ending…, Paused, read-only, Paused, Ended, read-only and Ended', () => {
    expect(transcriptConnection('pausing', false)).toEqual({ state: 'none', label: 'Ending…' });
    expect(transcriptConnection('paused', false)).toEqual({ state: 'ended', label: 'Paused, read-only' });
    expect(transcriptConnection('paused', true)).toEqual({ state: 'ended', label: 'Paused' });
    expect(transcriptConnection('ended', false)).toEqual({ state: 'ended', label: 'Ended, read-only' });
    expect(transcriptConnection('expired', false)).toEqual({ state: 'ended', label: 'Ended, read-only' });
    expect(transcriptConnection('ended', true)).toEqual({ state: 'ended', label: 'Ended' });
  });
});

describe('runsQueries.transcript', () => {
  afterEach(() => mockDb.reset());

  it('fetches the newest page, then the older page with before', async () => {
    const calls: Array<{ before: string | null; limit: string | null }> = [];
    server.use(
      routeHandler('runs.transcript', (request) => {
        const url = new URL(request.url);
        const before = url.searchParams.get('before');
        calls.push({ before, limit: url.searchParams.get('limit') });
        return Promise.resolve(
          jsonResponse(before === null ? page([entry(5), entry(6)], 5) : page([entry(1), entry(2)])),
        );
      }),
    );
    const qc = new QueryClient();
    const options = runsQueries.transcript(org, projectId, 61);
    expect(options.queryKey).toEqual([...runsQueries.detail(org, projectId, 61).queryKey, 'transcript']);
    const observer = new InfiniteQueryObserver(qc, options);
    const first = await observer.refetch();
    expect(first.data?.pages[0]?.items.map((e) => e.seq)).toEqual([5, 6]);
    expect(first.data?.pages.at(-1)?.nextBefore).toBe(5);
    const next = await observer.fetchNextPage();
    expect(next.data?.pages.map((p) => p.items.map((e) => e.seq))).toEqual([
      [5, 6],
      [1, 2],
    ]);
    expect(next.data?.pages.at(-1)?.nextBefore).toBeNull();
    expect(calls).toEqual([
      { before: null, limit: String(TRANSCRIPT_PAGE_SIZE) },
      { before: '5', limit: String(TRANSCRIPT_PAGE_SIZE) },
    ]);
  });
});

describe('useTranscriptReload', () => {
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const hook = renderHook(({ area }: { area: TerminalArea }) => useTranscriptReload(org, projectId, 61, area), {
      wrapper,
      initialProps: { area: 'live' as TerminalArea },
    });
    return { spy, hook };
  };
  const key = runsQueries.transcript(org, projectId, 61).queryKey;

  it('invalidates when a pausing run becomes paused and not while it stays live', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { spy, hook } = setup();
    hook.rerender({ area: 'live' });
    hook.rerender({ area: 'pausing' });
    expect(spy).not.toHaveBeenCalled();
    hook.rerender({ area: 'paused' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({ queryKey: key });
    act(() => vi.advanceTimersByTime(FINAL_LOG_RECHECK_MS));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a paused run that goes on to resume or start reloads nothing more', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { spy, hook } = setup();
    hook.rerender({ area: 'paused' });
    expect(spy).toHaveBeenCalledTimes(1);
    hook.rerender({ area: 'resuming' });
    hook.rerender({ area: 'starting' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
