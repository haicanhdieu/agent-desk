import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileSecretStore,
  KubeSecretStore,
  MemorySecretStore,
  credentialSecretName,
  createSecretStore,
  parseConfig,
  type SecretsApi,
} from '../src';

describe('credentialSecretName', () => {
  it('joins org and agent ids', () => {
    expect(credentialSecretName('o1', 'a1')).toBe('org-o1-agent-a1');
  });
});

describe.each([
  ['memory', async () => new MemorySecretStore()],
  ['file', async () => new FileSecretStore(join(await mkdtemp(join(tmpdir(), 'sec-')), 'secrets'))],
])('%s store', (_n, make) => {
  it('put/get/delete round-trips and overwrites', async () => {
    const s = await make();
    expect(await s.get('a-1')).toBeNull();
    await s.put('a-1', { type: 'api_key', value: 'v1' });
    await s.put('a-1', { type: 'api_key', value: 'v2' });
    expect(await s.get('a-1')).toEqual({ type: 'api_key', value: 'v2' });
    await s.delete('a-1');
    await s.delete('a-1');
    expect(await s.get('a-1')).toBeNull();
  });

  it.each(['../evil', 'a/b', 'A', '', 'a.b', 'x'.repeat(254)])('rejects unsafe name %j', async (name) => {
    const s = await make();
    await expect(s.put(name, { value: 'x' })).rejects.toThrow('invalid secret name');
    await expect(s.get(name)).rejects.toThrow('invalid secret name');
    await expect(s.delete(name)).rejects.toThrow('invalid secret name');
  });
});

describe('FileSecretStore permissions', () => {
  it('uses mode 0600 files in a 0700 directory and leaves no temp files', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'sec-')), 'secrets');
    const s = new FileSecretStore(dir);
    await s.put('a-1', { value: 'x' });
    await s.put('a-1', { value: 'y' });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'a-1.json'))).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(['a-1.json']);
  });
});

function mockApi() {
  return {
    createNamespacedSecret: vi.fn(),
    replaceNamespacedSecret: vi.fn(),
    readNamespacedSecret: vi.fn(),
    deleteNamespacedSecret: vi.fn(),
  } satisfies Record<keyof SecretsApi, unknown>;
}
const asApi = (m: ReturnType<typeof mockApi>) => m as unknown as SecretsApi;
const apiError = (code: number) => Object.assign(new Error('api'), { code });

describe('KubeSecretStore', () => {
  it('creates a labelled Opaque secret in the namespace', async () => {
    const api = mockApi();
    await new KubeSecretStore(asApi(api), 'agentdesk').put('org-1-agent-2', { type: 'api_key', value: 'v' });
    expect(api.createNamespacedSecret).toHaveBeenCalledWith({
      namespace: 'agentdesk',
      body: {
        metadata: {
          name: 'org-1-agent-2',
          namespace: 'agentdesk',
          labels: { 'app.kubernetes.io/managed-by': 'agentdesk', 'agentdesk/kind': 'credential' },
        },
        type: 'Opaque',
        stringData: { type: 'api_key', value: 'v' },
      },
    });
    expect(api.replaceNamespacedSecret).not.toHaveBeenCalled();
  });

  it('replaces when the secret already exists', async () => {
    const api = mockApi();
    api.createNamespacedSecret.mockRejectedValue(apiError(409));
    await new KubeSecretStore(asApi(api), 'ns').put('s-1', { value: 'v' });
    expect(api.replaceNamespacedSecret).toHaveBeenCalledWith(expect.objectContaining({ name: 's-1', namespace: 'ns' }));
  });

  it('propagates other create errors', async () => {
    const api = mockApi();
    api.createNamespacedSecret.mockRejectedValue(apiError(403));
    await expect(new KubeSecretStore(asApi(api), 'ns').put('s-1', { value: 'v' })).rejects.toThrow('api');
    expect(api.replaceNamespacedSecret).not.toHaveBeenCalled();
  });

  it('decodes data on get and maps 404 to null', async () => {
    const api = mockApi();
    api.readNamespacedSecret.mockResolvedValueOnce({ data: { value: Buffer.from('hello').toString('base64') } });
    const s = new KubeSecretStore(asApi(api), 'ns');
    expect(await s.get('s-1')).toEqual({ value: 'hello' });
    api.readNamespacedSecret.mockRejectedValueOnce(apiError(404));
    expect(await s.get('s-1')).toBeNull();
  });

  it('ignores 404 on delete and rejects unsafe names before any call', async () => {
    const api = mockApi();
    api.deleteNamespacedSecret.mockRejectedValue(apiError(404));
    const s = new KubeSecretStore(asApi(api), 'ns');
    await s.delete('s-1');
    await expect(s.put('../x', {})).rejects.toThrow('invalid secret name');
    expect(api.createNamespacedSecret).not.toHaveBeenCalled();
  });
});

describe('createSecretStore', () => {
  const base = {
    PUBLIC_ORIGIN: 'http://localhost:5173',
    DATABASE_APP_URL: 'x',
    DATABASE_OWNER_URL: 'x',
    DATABASE_ADMIN_URL: 'x',
    TEMPORAL_ADDRESS: 'x',
    TEMPORAL_NAMESPACE: 'x',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    RUNNER_IMAGE: 'x',
  };
  it('uses the file store in fake mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sec-'));
    const store = createSecretStore(parseConfig({ ...base, KUBE_MODE: 'fake', FAKE_STATE_DIR: dir }));
    expect(store).toBeInstanceOf(FileSecretStore);
    await store.put('a-1', { value: 'x' });
    expect(await readdir(join(dir, 'secrets'))).toEqual(['a-1.json']);
  });
});
