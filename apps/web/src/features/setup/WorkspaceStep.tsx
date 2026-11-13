import type { ProjectDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNow } from '@/app/useNow';
import { projectPaths } from '../desk/frame';
import { isStaleSetupScript, STALE_SETUP_SCRIPT, useCreateSetupTest, useEndSetupTest } from '../setup-script/mutations';
import { setupScriptSaveProblem, toDeskSetupProps, toSetupStepTest } from '../setup-script/map';
import { setupQueries as scriptQueries } from '../setup-script/queries';
import { useSetupTest } from '../setup-script/useSetupTest';
import type { Actor } from '@/mocks/types';
import { SetupWorkspace } from '@/screens';
import { browserLocation } from './location';
import { useSaveWorkspaceStep } from './mutations';

const GENERIC = 'Something went wrong. Try again.';
const messageOf = (e: unknown): string => (e instanceof ApiError ? (e.detail ?? e.title) : GENERIC);

interface Props {
  org: string;
  project: ProjectDto;
  user: Actor;
  credentialDetail: string | undefined;
  backHref: string;
  /** Moves on to the next step with the project as the server has it. */
  onDone(project: ProjectDto): void;
}

/**
 * Onboarding step "Prepare workspace": the Desk Setup tab's script, plugins and test, in the step's layout. Save and
 * continue stores the script; Skip does not. The test panel's log and terminal live on the Desk Setup tab, opened in a
 * new tab so this step stays where it is.
 */
export function WorkspaceStep({ org, project, user, credentialDetail, backHref, onDone }: Props) {
  const projectId = project.id;
  const qc = useQueryClient();
  const now = useNow();
  const { data: saved } = useSuspenseQuery(scriptQueries.script(org, projectId));
  const plugins = useQuery(scriptQueries.plugins(org, projectId));
  const latest = useQuery(scriptQueries.latest(org, projectId));
  const current = latest.data ?? null;
  const stream = useSetupTest(current?.id);
  const create = useCreateSetupTest(org, projectId);
  const end = useEndSetupTest(org, projectId);
  const save = useSaveWorkspaceStep(org);
  const [error, setError] = useState<string>();

  // Status frames keep the latest test's cache current, as on the Desk.
  const streamed = stream.test;
  useEffect(() => {
    if (streamed)
      qc.setQueryData(scriptQueries.latest(org, projectId).queryKey, (t) => (t?.id === streamed.id ? streamed : t));
  }, [qc, org, projectId, streamed]);

  const view = toDeskSetupProps(
    {
      script: saved,
      versions: [],
      plugins: plugins.data ?? { approvedStores: [], plugins: [], settingsError: null },
      latest: current,
      events: stream.events,
    },
    now,
  );

  const fail = (e: unknown) => setError(isStaleSetupScript(e) ? STALE_SETUP_SCRIPT : messageOf(e));
  const deskSetup = projectPaths(org, projectId).setup;

  const finish = (body: string | null) => {
    if (body !== null) {
      const problem = setupScriptSaveProblem(body, '');
      if (problem !== undefined) {
        setError(problem);
        return;
      }
    }
    setError(undefined);
    save.mutate({ project, saved, body }, { onSuccess: onDone, onError: fail });
  };

  const onTest = (body: string) => {
    if (create.isPending) return;
    const problem = setupScriptSaveProblem(body, '');
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    setError(undefined);
    create.mutate(body, { onError: fail });
  };

  return (
    <SetupWorkspace
      user={user}
      projectName={project.name}
      repo={project.repoPath}
      {...(credentialDetail !== undefined && { credentialDetail })}
      {...(saved && { script: saved.body })}
      plugins={
        plugins.isPending
          ? { plugins: [], loading: true }
          : plugins.isError
            ? { plugins: [], error: 'Could not load the plugins. Reload to try again.' }
            : view.plugins
      }
      test={toSetupStepTest(view)}
      saving={save.isPending}
      saveError={error}
      backHref={backHref}
      onTest={onTest}
      onOpenTerminal={() => browserLocation.openInNewTab(deskSetup)}
      onViewLog={() => browserLocation.openInNewTab(deskSetup)}
      onEndTest={() => {
        if (current !== null) end.mutate(current.id, { onError: fail });
      }}
      onContinue={finish}
      onSkip={() => finish(null)}
    />
  );
}
