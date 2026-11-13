import type { SetupScriptDto } from '@agentdesk/contracts';
import { apiPath, ApiError } from '@agentdesk/contracts/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNow } from '@/app/useNow';
import type { LiveTerminalHandle } from '@/components/LiveTerminal';
import { Banner, Skeleton } from '@/ds';
import { useDeskFrame } from '@/features/desk/frame';
import { useTerminalSocket } from '@/features/runs/useTerminal';
import {
  isStaleSetupScript,
  STALE_SETUP_SCRIPT,
  useCreateSetupTest,
  useEndSetupTest,
  useSaveSetupScript,
} from '@/features/setup-script/mutations';
import { setupScriptSaveProblem, toDeskSetupProps } from '@/features/setup-script/map';
import { setupQueries } from '@/features/setup-script/queries';
import { useSetupTest } from '@/features/setup-script/useSetupTest';
import { DeskSetup, type DeskFrameData } from '@/screens';

// xterm downloads only when a test workspace shows its terminal (spec §5.3).
const LiveTerminal = lazy(() => import('@/components/LiveTerminal'));

export const Route = createFileRoute('/o/$org/p/$project/desk/setup')({
  component: DeskSetupPage,
});

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
  const versions = useQuery(setupQueries.versions(org, projectId));
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
  const settled = current !== null && !ended && (current.status === 'passed' || current.status === 'failed');
  const termRef = useRef<LiveTerminalHandle | null>(null);
  const [termReady, setTermReady] = useState(false);
  const attachTerm = useCallback((handle: LiveTerminalHandle | null) => {
    termRef.current = handle;
    if (handle) setTermReady(true);
  }, []);
  // The session ended (the test ended or its workspace is gone): the latest test refetches and shows its end state.
  const onSessionEnd = useCallback(async () => {
    const key = setupQueries.latest(org, projectId).queryKey;
    await qc.invalidateQueries({ queryKey: key });
    const t = qc.getQueryData(key);
    return t != null && t.endedAt === null && t.status !== 'ended';
  }, [qc, org, projectId]);
  const terminalPath = apiPath('setupTests.terminal', { setupTestId: current?.id ?? '-' });
  const term = useTerminalSocket(terminalPath, settled && termReady, termRef, onSessionEnd);

  let terminal: ReactNode;
  if (settled && term.state === 'forbidden') {
    terminal = <Banner tone="err" flush live="polite" title="You can't open this terminal" />;
  } else if (settled && current) {
    terminal = (
      <Suspense fallback={<TerminalLoading />}>
        <LiveTerminal key={`live:${current.id}`} ref={attachTerm} onData={term.onData} onResize={term.onResize} />
      </Suspense>
    );
  }

  const view = toDeskSetupProps(
    {
      script,
      versions: versions.data ?? [],
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
      versionsLoading={versions.isPending}
      versionsError={versions.isError ? 'Could not load the version history. Reload to try again.' : undefined}
      test={view.test && terminal ? { ...view.test, terminal } : view.test}
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

function TerminalLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the terminal" role="status">
      <Skeleton variant="text" lines={6} width="100%" />
    </div>
  );
}
