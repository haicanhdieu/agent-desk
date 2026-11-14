import type { SetupTestDto } from '@agentdesk/contracts';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeEventSource } from '@/test/fakeEventSource';
import { useSetupTest } from './useSetupTest';

const ID = 'b0000000-0000-4000-8000-000000000001';
const ended: SetupTestDto = {
  id: ID,
  projectId: 'a0000000-0000-4000-8000-000000000001',
  status: 'failed',
  scriptSha256: 'a'.repeat(64),
  matchesCurrentScript: true,
  checkoutSha: null,
  plugins: { installed: [], skipped: [], failed: [] },
  exitCode: 127,
  startedBy: 'kim-hale',
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  endsAt: null,
};

describe('useSetupTest', () => {
  it('an already-ended test: the status frame comes first and the backlog after it is still read', () => {
    const { result } = renderHook(() => useSetupTest(ID));
    const source = FakeEventSource.latest();
    act(() => {
      source.open();
      // The server's order: status, then the stored events, then it closes the stream.
      source.emit('status', ended);
      source.emit(
        'event',
        { seq: 1, ts: new Date().toISOString(), type: 'lifecycle', payload: { kind: 'setup_begin' } },
        1,
      );
      source.emit(
        'event',
        { seq: 2, ts: new Date().toISOString(), type: 'lifecycle', payload: { kind: 'setup_failed' } },
        2,
      );
    });
    expect(result.current.test?.status).toBe('failed');
    expect(result.current.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('after the server ends the stream of an ended test, the client closes it and does not reconnect', () => {
    renderHook(() => useSetupTest(ID));
    const source = FakeEventSource.latest();
    act(() => {
      source.open();
      source.emit('status', ended);
      source.fail(); // the server closed it; the browser would reconnect (CONNECTING)
    });
    expect(source.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
