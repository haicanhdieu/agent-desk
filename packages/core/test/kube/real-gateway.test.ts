import type { Writable } from 'node:stream';
import { ApiException, type V1Job, type V1Pod } from '@kubernetes/client-node';
import { describe, expect, it, vi } from 'vitest';
import {
  RealKubeGateway,
  type ExecConnector,
  type ExecSocket,
  type KubeBatchApi,
  type KubeCoreApi,
  type KubeLogApi,
} from '../../src/kube/real-gateway';

const NS = 'agentdesk-runs';
const apiErr = (code: number) => new ApiException(code, `HTTP ${code}`, {}, {});

function mocks() {
  const batch = {
    createNamespacedJob: vi.fn(async (_: { namespace: string; body: V1Job }) => ({})),
    deleteNamespacedJob: vi.fn(async (_: { name: string; namespace: string; propagationPolicy?: string }) => ({})),
    listNamespacedJob: vi.fn(async (_: { namespace: string; labelSelector?: string }) => ({ items: [] as V1Job[] })),
  };
  const core = {
    createNamespacedSecret: vi.fn(async (_: { namespace: string; body: unknown }) => ({})),
    readNamespacedSecret: vi.fn(async (_: { name: string; namespace: string }) => ({
      data: {} as Record<string, string>,
    })),
    deleteNamespacedSecret: vi.fn(async (_: { name: string; namespace: string }) => ({})),
    listNamespacedPod: vi.fn(async (_: { namespace: string; labelSelector?: string }) => ({ items: [] as V1Pod[] })),
    listNamespacedSecret: vi.fn(async (_: { namespace: string; labelSelector?: string }) => ({
      items: [] as { metadata?: { name?: string; labels?: Record<string, string> } }[],
    })),
  };
  const log = { log: vi.fn() };
  const sent: Buffer[] = [];
  let onBinary: ((stream: number, data: Buffer) => boolean) | undefined;
  let closeCb: (() => void) | undefined;
  const socket: ExecSocket = {
    send: (d) => void sent.push(Buffer.from(d)),
    close: vi.fn(() => closeCb?.()),
    on: (_e, cb) => {
      closeCb = cb;
    },
  };
  const ws: ExecConnector & { path?: string } = {
    connect: vi.fn(async (path: string, cb: (stream: number, data: Buffer) => boolean) => {
      ws.path = path;
      onBinary = cb;
      return socket;
    }),
  };
  const gw = new RealKubeGateway({
    batch: batch as unknown as KubeBatchApi,
    core: core as unknown as KubeCoreApi,
    log: log as unknown as KubeLogApi,
    ws,
    namespace: NS,
  });
  return {
    gw,
    batch,
    core,
    log,
    ws,
    sent,
    emit: (s: number, d: string) => onBinary?.(s, Buffer.from(d)),
    closeSocket: () => closeCb?.(),
  };
}

describe('RealKubeGateway', () => {
  it('create calls treat 409 as success, other errors propagate', async () => {
    const m = mocks();
    m.batch.createNamespacedJob.mockRejectedValueOnce(apiErr(409));
    await m.gw.ensureJob({ metadata: { name: 'run-x' } });
    expect(m.batch.createNamespacedJob).toHaveBeenCalledWith({ namespace: NS, body: { metadata: { name: 'run-x' } } });
    m.core.createNamespacedSecret.mockRejectedValueOnce(apiErr(409));
    await m.gw.ensureSecret('run-x', { A: 'b' }, { 'agentdesk/run-id': 'x' });
    expect(m.core.createNamespacedSecret).toHaveBeenCalledWith({
      namespace: NS,
      body: {
        metadata: { name: 'run-x', namespace: NS, labels: { 'agentdesk/run-id': 'x' } },
        type: 'Opaque',
        stringData: { A: 'b' },
      },
    });
    m.batch.createNamespacedJob.mockRejectedValueOnce(apiErr(403));
    await expect(m.gw.ensureJob({ metadata: { name: 'run-x' } })).rejects.toThrow();
  });

  it('delete calls treat 404 as success and delete the Job in the foreground', async () => {
    const m = mocks();
    m.batch.deleteNamespacedJob.mockRejectedValueOnce(apiErr(404));
    await m.gw.deleteJob('run-x');
    expect(m.batch.deleteNamespacedJob).toHaveBeenCalledWith({
      name: 'run-x',
      namespace: NS,
      propagationPolicy: 'Foreground',
    });
    m.core.deleteNamespacedSecret.mockRejectedValueOnce(apiErr(404));
    await m.gw.deleteSecret('run-x');
    m.core.deleteNamespacedSecret.mockRejectedValueOnce(apiErr(500));
    await expect(m.gw.deleteSecret('run-x')).rejects.toThrow();
  });

  it('readSecret decodes base64 data; 404 → null', async () => {
    const m = mocks();
    m.core.readNamespacedSecret.mockResolvedValueOnce({ data: { A: Buffer.from('v').toString('base64') } });
    expect(await m.gw.readSecret('run-x')).toEqual({ A: 'v' });
    m.core.readNamespacedSecret.mockRejectedValueOnce(apiErr(404));
    expect(await m.gw.readSecret('run-x')).toBeNull();
  });

  it('getRunPod maps phase, pending reason and exit code', async () => {
    const m = mocks();
    const created = new Date('2026-11-12T10:00:00Z');
    m.core.listNamespacedPod.mockResolvedValueOnce({
      items: [
        {
          metadata: { name: 'run-x-abc', creationTimestamp: created },
          status: {
            phase: 'Pending',
            containerStatuses: [
              {
                name: 'agent',
                image: 'i',
                imageID: '',
                ready: false,
                restartCount: 0,
                state: { waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image "i"' } },
              },
            ],
          },
        },
      ],
    });
    expect(await m.gw.getRunPod('run-x')).toEqual({
      name: 'run-x-abc',
      phase: 'Pending',
      pendingSince: created,
      reason: 'ImagePullBackOff: Back-off pulling image "i"',
      exitCode: null,
    });
    expect(m.core.listNamespacedPod).toHaveBeenCalledWith({
      namespace: NS,
      labelSelector: 'batch.kubernetes.io/job-name=run-x',
    });

    m.core.listNamespacedPod.mockResolvedValueOnce({
      items: [
        {
          metadata: { name: 'run-x-abc' },
          status: {
            phase: 'Failed',
            containerStatuses: [
              {
                name: 'agent',
                image: 'i',
                imageID: '',
                ready: false,
                restartCount: 0,
                state: { terminated: { exitCode: 2, reason: 'Error' } },
              },
            ],
          },
        },
      ],
    });
    expect(await m.gw.getRunPod('run-x')).toMatchObject({ phase: 'Failed', exitCode: 2, pendingSince: null });
    m.core.listNamespacedPod.mockResolvedValueOnce({ items: [] });
    expect(await m.gw.getRunPod('run-x')).toBeNull();
  });

  it('listRunJobs reads the agentdesk labels and skips Jobs without them', async () => {
    const m = mocks();
    m.batch.listNamespacedJob.mockResolvedValueOnce({
      items: [
        {
          metadata: {
            name: 'run-a',
            labels: { 'agentdesk/run-id': 'a', 'agentdesk/org-id': 'o', 'agentdesk/project-id': 'p' },
          },
        },
        { metadata: { name: 'run-b', labels: { 'agentdesk/run-id': 'b' } } },
      ],
    });
    expect(await m.gw.listRunJobs()).toEqual([{ jobName: 'run-a', runId: 'a', orgId: 'o', projectId: 'p' }]);
    expect(m.batch.listNamespacedJob).toHaveBeenCalledWith({ namespace: NS, labelSelector: 'agentdesk/run-id' });
  });

  it('listRunSecrets reads the agentdesk labels of Secrets', async () => {
    const m = mocks();
    m.core.listNamespacedSecret.mockResolvedValueOnce({
      items: [
        {
          metadata: {
            name: 'run-a',
            labels: { 'agentdesk/run-id': 'a', 'agentdesk/org-id': 'o', 'agentdesk/project-id': 'p' },
          },
        },
        { metadata: { name: 'other', labels: { 'agentdesk/run-id': 'b' } } },
      ],
    });
    expect(await m.gw.listRunSecrets()).toEqual([{ secretName: 'run-a', runId: 'a', orgId: 'o', projectId: 'p' }]);
    expect(m.core.listNamespacedSecret).toHaveBeenCalledWith({ namespace: NS, labelSelector: 'agentdesk/run-id' });
  });

  it('streamLogs yields whole lines from the followed log and stops on abort', async () => {
    const m = mocks();
    let sink: Writable | undefined;
    const abort = vi.fn();
    m.log.log.mockImplementation(async (_ns: string, _pod: string, _c: string, w: Writable) => {
      sink = w;
      return { abort } as unknown as AbortController;
    });
    const ac = new AbortController();
    const lines: string[] = [];
    const done = (async () => {
      for await (const l of m.gw.streamLogs('run-x-abc', ac.signal)) lines.push(l);
    })();
    await vi.waitFor(() => expect(sink).toBeDefined());
    expect(m.log.log).toHaveBeenCalledWith(NS, 'run-x-abc', 'agent', expect.anything(), { follow: true });
    sink?.write('agentdesk: session st');
    sink?.write('arted\r\nagentdesk: turn finished\n');
    await vi.waitFor(() => expect(lines).toEqual(['agentdesk: session started', 'agentdesk: turn finished']));
    ac.abort();
    await done;
    expect(abort).toHaveBeenCalled();
  });

  it('exec uses the exec endpoint, stdin on channel 0, resize on channel 4 and status on channel 3', async () => {
    const m = mocks();
    const s = await m.gw.exec('run-x-abc', ['tmux', 'attach', '-t', 'agent'], { tty: true });
    expect(m.ws.path).toBe(
      `/api/v1/namespaces/${NS}/pods/run-x-abc/exec?command=tmux&command=attach&command=-t&command=agent` +
        '&container=agent&stdin=true&stdout=true&stderr=true&tty=true',
    );
    const got: string[] = [];
    s.onData((d) => got.push(Buffer.from(d).toString()));
    m.emit(1, 'screen');
    m.emit(2, 'err');
    expect(got).toEqual(['screen', 'err']);
    s.write(new TextEncoder().encode('ls\r'));
    s.resize(120, 40);
    expect(m.sent[0]?.[0]).toBe(0);
    expect(m.sent[0]?.subarray(1).toString()).toBe('ls\r');
    expect(m.sent[1]?.[0]).toBe(4);
    expect(JSON.parse(m.sent[1]?.subarray(1).toString() ?? '')).toEqual({ Width: 120, Height: 40 });
    const codes: number[] = [];
    s.onClose((c) => codes.push(c));
    m.emit(
      3,
      JSON.stringify({
        status: 'Failure',
        details: { causes: [{ reason: 'ExitCode', message: '7' }] },
      }),
    );
    m.closeSocket();
    expect(codes).toEqual([7]);
  });

  it('exec status Success → close code 0', async () => {
    const m = mocks();
    const s = await m.gw.exec('p', ['tmux', 'kill-session', '-t', 'agent'], { tty: false });
    const codes: number[] = [];
    s.onClose((c) => codes.push(c));
    m.emit(3, JSON.stringify({ status: 'Success' }));
    m.closeSocket();
    expect(codes).toEqual([0]);
    expect(m.ws.path).toContain('tty=false');
  });
});
