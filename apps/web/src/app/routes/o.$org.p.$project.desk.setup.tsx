import type { EnvKind, SetupScriptDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  PageSearch,
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { requireProjectPermission, useCan } from '@/features/access/guards';
import { useDeskFrame } from '@/features/desk/frame';
import {
  isStaleSetupScript,
  STALE_SETUP_SCRIPT,
  useCreateEnvEntry,
  useCreateSetupTest,
  useEndSetupTest,
  useRemoveEnvEntry,
  useSaveSetupScript,
  useUpdateEnvEntry,
} from '@/features/setup-script/mutations';
import { setupScriptSaveProblem, toDeskSetupProps, toEnvRows } from '@/features/setup-script/map';
import { setupQueries } from '@/features/setup-script/queries';
import { useSetupTest } from '@/features/setup-script/useSetupTest';
import { useToast } from '@/ds';
import { DeskSetup, type DeskFrameData, type DeskSetupTab, type EnvListGroup } from '@/screens';

// `tab` is left out of the URL for the script tab; bad input of any param falls back to its default.
const SetupSearch = PageSearch.extend({
  tab: z.enum(['script', 'environment']).optional().catch(undefined),
  varsPage: PageSearch.shape.page,
  secretsPage: PageSearch.shape.page,
});

export const Route = createFileRoute('/o/$org/p/$project/desk/setup')({
  staticData: { chrome: { mode: 'standard', scope: 'project', item: 'setup', crumb: 'Workspace setup', fill: true } },
  validateSearch: (search) => SetupSearch.parse(search),
  // Desk config is for roles that hold `setup:read` on this project; the guard runs before any loader.
  beforeLoad: ({ context: { queryClient }, params }) =>
    requireProjectPermission(queryClient, params.org, 'setup:read', params.project),
  component: DeskSetupPage,
});

const LOAD_ENV_ERROR = 'Could not load the environment. Reload to try again.';
const GENERIC = 'Something went wrong. Try again.';
const messageOf = (e: unknown): string => (e instanceof ApiError ? (e.detail ?? e.title) : GENERIC);

function DeskSetupPage() {
  const { org, project: projectId } = Route.useParams();
  const now = useNow();
  const frame = useDeskFrame(org, projectId, now);
  const script = useQuery(setupQueries.script(org, projectId));

  // The editor takes its text from the script once, so it only mounts when the script is there.
  if (!script.isSuccess) {
    return (
      <DeskSetup
        frame={frame}
        loading={script.isPending}
        loadError={script.isError ? messageOf(script.error) : undefined}
        plugins={{ plugins: [] }}
        versions={[]}
      />
    );
  }
  return <SetupEditor org={org} projectId={projectId} frame={frame} script={script.data} now={now} />;
}

interface EnvGroupArgs {
  org: string;
  projectId: string;
  kind: EnvKind;
  page: number;
  /** Lists load only while the Environment tab is open. */
  enabled: boolean;
  canWrite: boolean;
  now: Date;
  goToPage(page: number, replace?: boolean): void;
}

/** One list of the Environment tab: its page query, paging, loading and error state, and its writes. */
function useEnvGroup({ org, projectId, kind, page, enabled, canWrite, now, goToPage }: EnvGroupArgs): EnvListGroup {
  const toast = useToast();
  const [pageSize] = usePageSize();
  const query = useQuery({
    ...setupQueries.env(org, projectId, { kind, page, pageSize }),
    placeholderData: keepPreviousData,
    enabled,
  });
  const total = query.data?.total ?? 0;
  useClampToLastPage(page, pageSize, total, (p) => goToPage(p, true));
  const pagination = usePaginationProps({
    page: query.data?.page ?? page,
    pageSize: query.data?.pageSize,
    total,
    busy: query.isPlaceholderData,
    go: goToPage,
  });
  const create = useCreateEnvEntry(org, projectId, kind);
  const update = useUpdateEnvEntry(org, projectId, kind);
  const remove = useRemoveEnvEntry(org, projectId, kind);
  const failed = query.isError && query.data === undefined;
  return {
    entries: toEnvRows(query.data?.items ?? [], now),
    total,
    loading: query.isPending,
    ...(failed && {
      loadError: {
        message: LOAD_ENV_ERROR,
        ...(query.error instanceof ApiError &&
          query.error.requestId !== undefined && { requestId: query.error.requestId }),
      },
    }),
    onRetry: () => void query.refetch(),
    canWrite,
    pagination,
    onCreate: async (input) => {
      const error = await create.save(input);
      if (error === null) toast.show({ tone: 'ok', title: `Added ${input.name}` });
      return error;
    },
    onUpdate: (name, value) => update.save({ name, value }),
    onRemove: (name) => remove.save(name),
  };
}

interface EditorProps {
  org: string;
  projectId: string;
  frame: DeskFrameData;
  /** The saved script; the version it had when the page opened is the base of every save. */
  script: SetupScriptDto | null;
  now: Date;
}

function SetupEditor({ org, projectId, frame, script, now }: EditorProps) {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const currentPage = pageOfSearch(Route.useSearch());
  const [pageSize] = usePageSize();
  const versions = useQuery({
    ...setupQueries.versions(org, projectId, { page: currentPage, pageSize }),
    placeholderData: keepPreviousData,
  });
  const search = Route.useSearch();
  const tab: DeskSetupTab = search.tab ?? 'script';
  const goToPage = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  const envArgs = { org, projectId, now, enabled: tab === 'environment' };
  const variables = useEnvGroup({
    ...envArgs,
    kind: 'plain',
    page: pageOfSearch({ page: search.varsPage }),
    canWrite: useCan(org, 'setup:update', { projectId }),
    goToPage: (p, replace = false) =>
      void navigate({ search: (prev) => ({ ...prev, varsPage: pageToSearch(p) }), replace }),
  });
  const secrets = useEnvGroup({
    ...envArgs,
    kind: 'secret',
    page: pageOfSearch({ page: search.secretsPage }),
    canWrite: useCan(org, 'secret:update', { projectId }),
    goToPage: (p, replace = false) =>
      void navigate({ search: (prev) => ({ ...prev, secretsPage: pageToSearch(p) }), replace }),
  });
  useClampToLastPage(currentPage, pageSize, versions.data?.total ?? 0, (p) => goToPage(p, true));
  const versionsPagination = usePaginationProps({
    page: versions.data?.page ?? currentPage,
    pageSize: versions.data?.pageSize,
    total: versions.data?.total ?? 0,
    busy: versions.isPlaceholderData,
    go: goToPage,
  });
  const plugins = useQuery(setupQueries.plugins(org, projectId));
  const latest = useQuery(setupQueries.latest(org, projectId));
  const current = latest.data ?? null;
  const stream = useSetupTest(current?.id);

  // The version the draft started from: the page's first load, then each version this page saved.
  const [baseVersion, setBaseVersion] = useState<number | null>(script?.version ?? null);
  const [actionError, setActionError] = useState<string>();
  // The editor's starting text after viewing or restoring a version (and the key that remounts it with that text).
  const [draft, setDraft] = useState<{ body: string; key: number }>();
  // An ended test's stored log, opened from "View log".
  const [logOpen, setLogOpen] = useState(false);

  const save = useSaveSetupScript(org, projectId);
  const create = useCreateSetupTest(org, projectId);
  const end = useEndSetupTest(org, projectId);

  // Status frames keep the latest test's cache current (the test panel, then the last-test banner after it ends).
  const streamed = stream.test;
  useEffect(() => {
    if (streamed)
      qc.setQueryData(setupQueries.latest(org, projectId).queryKey, (t) => (t?.id === streamed.id ? streamed : t));
  }, [qc, org, projectId, streamed]);

  const ended = current !== null && (current.endedAt !== null || current.status === 'ended');

  const view = toDeskSetupProps(
    {
      script,
      versions: versions.data?.items ?? [],
      plugins: plugins.data ?? { approvedStores: [], plugins: [], settingsError: null },
      latest: current,
      events: stream.events,
    },
    now,
    { showEnded: logOpen },
  );

  const fail = (e: unknown) => setActionError(isStaleSetupScript(e) ? STALE_SETUP_SCRIPT : messageOf(e));

  const onSave = (body: string, note: string) => {
    const problem = setupScriptSaveProblem(body, note);
    if (problem !== undefined) {
      setActionError(problem);
      return;
    }
    setActionError(undefined);
    save.mutate(
      { body, note: note.trim(), baseVersion },
      {
        onSuccess: (saved) => setBaseVersion(saved.version),
        onError: fail,
      },
    );
  };

  const onTest = (body: string) => {
    if (create.isPending) return;
    const problem = setupScriptSaveProblem(body, '');
    if (problem !== undefined) {
      setActionError(problem);
      return;
    }
    setActionError(undefined);
    create.mutate(body, { onSuccess: () => setLogOpen(false), onError: fail });
  };

  const onEndTest = () => {
    if (current === null) return;
    // An ended test opened as a log has no workspace left: End closes the log.
    if (ended) {
      setLogOpen(false);
      return;
    }
    end.mutate(current.id, { onError: fail });
  };

  /** A saved version's text, for the editor. */
  const loadVersion = (version: number) =>
    qc.fetchQuery(setupQueries.version(org, projectId, version)).catch((e: unknown) => {
      fail(e);
      return undefined;
    });

  const onViewVersion = (version: number) => {
    setActionError(undefined);
    void loadVersion(version).then((v) => {
      if (v) setDraft({ body: v.body, key: (draft?.key ?? 0) + 1 });
    });
  };

  const onRestore = (version: number) => {
    setActionError(undefined);
    void loadVersion(version).then((v) => {
      if (!v) return;
      save.mutate(
        { body: v.body, note: `Restored from version ${version}`, baseVersion },
        {
          onSuccess: (saved) => {
            setBaseVersion(saved.version);
            setDraft({ body: saved.body, key: (draft?.key ?? 0) + 1 });
          },
          onError: fail,
        },
      );
    });
  };

  return (
    <DeskSetup
      key={draft?.key ?? 0}
      frame={frame}
      {...view}
      {...(draft && { draft: draft.body })}
      plugins={
        plugins.isPending
          ? { plugins: [], loading: true }
          : plugins.isError
            ? { plugins: [], error: 'Could not load the plugins. Reload to try again.' }
            : view.plugins
      }
      versionsTotal={versions.data?.total ?? 0}
      versionsPagination={versionsPagination}
      versionsLoading={versions.isPending}
      versionsError={versions.isError ? 'Could not load the version history. Reload to try again.' : undefined}
      tab={tab}
      onTabChange={(next) =>
        void navigate({ search: (prev) => ({ ...prev, tab: next === 'script' ? undefined : next }) })
      }
      environment={{ variables, secrets, testRunning: view.test?.status === 'running' }}
      saving={save.isPending}
      saveError={actionError}
      onSave={onSave}
      onTest={onTest}
      onEndTest={onEndTest}
      onViewLog={() => setLogOpen(true)}
      onViewVersion={onViewVersion}
      onRestore={onRestore}
    />
  );
}
