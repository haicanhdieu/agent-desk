import { describe, expect, it } from 'vitest';
import { buildRunJob, runPodConfigFrom, type RunJobInput } from '../../src/kube/job-spec';

const RUN = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

const input = (over: Partial<RunJobInput> = {}): RunJobInput => ({
  runId: RUN,
  orgId: ORG,
  projectId: PROJECT,
  image: 'agentdesk/runner-claude:poc',
  prompt: 'Use the skill "fix" on issue #1 in dev/demo.\n$(rm -rf /); `id`',
  checkoutRef: 'main',
  cloneUrlSecretKey: 'REPO_CLONE_URL',
  maxTurns: 30,
  timeoutSeconds: 1800,
  botName: 'agentdesk[bot]',
  botEmail: 'bot@example.invalid',
  pluginMarketplaces: { 'claude-plugins-official': 'anthropics/claude-plugins-official' },
  setupTimeoutSeconds: 600,
  setupScript: null,
  pod: {
    cpuRequest: '500m',
    cpuLimit: '2',
    memoryRequest: '1Gi',
    memoryLimit: '4Gi',
    ephemeralStorageLimit: '4Gi',
    workspaceSizeLimit: '2Gi',
  },
  ...over,
});

describe('buildRunJob', () => {
  it('passes plugin marketplaces and the setup timeout as env values', () => {
    const env = buildRunJob(input()).spec?.template.spec?.containers[0]?.env ?? [];
    expect(env).toContainEqual({
      name: 'PLUGIN_MARKETPLACES',
      value: '{"claude-plugins-official":"anthropics/claude-plugins-official"}',
    });
    expect(env).toContainEqual({ name: 'SETUP_TIMEOUT_SECONDS', value: '600' });
  });

  it('SETUP_SCRIPT is present iff the script is non-empty, byte for byte', () => {
    const envOf = (setupScript: string | null) =>
      buildRunJob(input({ setupScript })).spec?.template.spec?.containers[0]?.env ?? [];
    expect(envOf(null).some((e) => e.name === 'SETUP_SCRIPT')).toBe(false);
    expect(envOf('').some((e) => e.name === 'SETUP_SCRIPT')).toBe(false);
    const body = 'echo "héllo ✓"\r\nnpm ci $(id)';
    expect(envOf(body)).toContainEqual({ name: 'SETUP_SCRIPT', value: body });
  });

  it('has the key fields of spec §8', () => {
    const job = buildRunJob(input());
    const labels = { 'agentdesk/run-id': RUN, 'agentdesk/project-id': PROJECT, 'agentdesk/org-id': ORG };
    expect(job.metadata?.name).toBe(`run-${RUN}`);
    expect(job.metadata?.labels).toMatchObject(labels);
    expect(job.spec?.activeDeadlineSeconds).toBe(1920);
    expect(job.spec?.backoffLimit).toBe(0);
    expect(job.spec?.ttlSecondsAfterFinished).toBe(3600);
    const pod = job.spec?.template.spec;
    expect(job.spec?.template.metadata?.labels).toMatchObject(labels);
    expect(pod?.restartPolicy).toBe('Never');
    expect(pod?.automountServiceAccountToken).toBe(false);
    expect(pod?.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 10001,
      runAsGroup: 10001,
      seccompProfile: { type: 'RuntimeDefault' },
    });
    const c = pod?.containers[0];
    expect(c?.name).toBe('agent');
    expect(c?.image).toBe('agentdesk/runner-claude:poc');
    expect(c?.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      runAsNonRoot: true,
      runAsUser: 10001,
      capabilities: { drop: ['ALL'] },
    });
    expect(c?.envFrom).toEqual([{ secretRef: { name: `run-${RUN}` } }]);
    expect(c?.resources).toEqual({
      requests: { cpu: '500m', memory: '1Gi' },
      limits: { cpu: '2', memory: '4Gi', 'ephemeral-storage': '4Gi' },
    });
    expect(pod?.volumes).toEqual([{ name: 'workspace', emptyDir: { sizeLimit: '2Gi' } }]);
    expect(c?.volumeMounts).toEqual([{ name: 'workspace', mountPath: '/workspace' }]);
    expect(pod?.nodeSelector).toBeUndefined();
    expect(pod?.tolerations).toBeUndefined();
    expect(pod?.runtimeClassName).toBeUndefined();
  });

  it('passes the prompt and other values only as env values (no command, no shell)', () => {
    const job = buildRunJob(input());
    const c = job.spec?.template.spec?.containers[0];
    expect(c?.command).toBeUndefined();
    expect(c?.args).toBeUndefined();
    const env = Object.fromEntries((c?.env ?? []).map((e) => [e.name, e.value]));
    expect(env).toEqual({
      CHECKOUT_REF: 'main',
      PROMPT: 'Use the skill "fix" on issue #1 in dev/demo.\n$(rm -rf /); `id`',
      BOT_NAME: 'agentdesk[bot]',
      BOT_EMAIL: 'bot@example.invalid',
      MAX_TURNS: '30',
      PLUGIN_MARKETPLACES: '{"claude-plugins-official":"anthropics/claude-plugins-official"}',
      SETUP_TIMEOUT_SECONDS: '600',
    });
    // The clone URL (with its token) comes from the Secret, never from a literal env value.
    expect(JSON.stringify(job)).not.toContain('REPO_CLONE_URL');
  });

  it('omits MAX_TURNS when unset and clamps the deadline to the 3300 s cap', () => {
    const job = buildRunJob(input({ maxTurns: null, timeoutSeconds: 9999 }));
    const env = job.spec?.template.spec?.containers[0]?.env ?? [];
    expect(env.map((e) => e.name)).not.toContain('MAX_TURNS');
    expect(job.spec?.activeDeadlineSeconds).toBe(3420);
  });

  it('adds nodeSelector, tolerations and runtimeClassName when configured', () => {
    const job = buildRunJob(
      input({
        pod: {
          ...input().pod,
          nodeSelector: { pool: 'runs' },
          tolerations: [{ key: 'runs', operator: 'Exists', effect: 'NoSchedule' }],
          runtimeClassName: 'gvisor',
        },
      }),
    );
    const pod = job.spec?.template.spec;
    expect(pod?.nodeSelector).toEqual({ pool: 'runs' });
    expect(pod?.tolerations).toEqual([{ key: 'runs', operator: 'Exists', effect: 'NoSchedule' }]);
    expect(pod?.runtimeClassName).toBe('gvisor');
  });

  it('runPodConfigFrom maps RUN_POD_* config', () => {
    expect(
      runPodConfigFrom({
        RUN_POD_CPU_REQUEST: '1',
        RUN_POD_CPU_LIMIT: '3',
        RUN_POD_MEMORY_REQUEST: '2Gi',
        RUN_POD_MEMORY_LIMIT: '5Gi',
        RUN_POD_EPHEMERAL_STORAGE_LIMIT: '6Gi',
        RUN_POD_WORKSPACE_SIZE_LIMIT: '3Gi',
        RUN_POD_NODE_SELECTOR: undefined,
        RUN_POD_TOLERATIONS: undefined,
        RUN_POD_RUNTIME_CLASS: 'kata',
      }),
    ).toEqual({
      cpuRequest: '1',
      cpuLimit: '3',
      memoryRequest: '2Gi',
      memoryLimit: '5Gi',
      ephemeralStorageLimit: '6Gi',
      workspaceSizeLimit: '3Gi',
      runtimeClassName: 'kata',
    });
  });
});
