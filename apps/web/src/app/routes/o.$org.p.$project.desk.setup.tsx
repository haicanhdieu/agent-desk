import type { SetupScriptDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useNow } from '@/app/useNow';
import { useDeskFrame } from '@/features/desk/frame';
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
        height="viewport"
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
      height="viewport"
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
