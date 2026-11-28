import { ApiError } from '@agentdesk/contracts/client';
import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import {
  PageSearch,
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import type { AgentListProps } from '@/components';
import { limitsOf, useSaveLimits } from '@/features/desk/agent.form';
import { useAgentPane, useAgentRowActions, useAgentTester } from '@/features/desk/agent.pane';
import { checkNowMessage, failedPollMessage } from '@/features/desk/checkNow';
import { requireProjectPermission, useCan } from '@/features/access/guards';
import { useDeskFrame } from '@/features/desk/frame';
import { forgetProject, useCheckNow, useDeleteProject, useSaveTrigger } from '@/features/desk/mutations';
import { toAgentRowView } from '@/features/desk/agents.map';
import { deskQueries } from '@/features/desk/queries';
import { pollIntervalLabel } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { lastEvent, pollSeconds } from '@/features/setup/map';
import { connectionCopy } from '@/mocks/connection';
import type { PollInterval, TriggerMode } from '@/mocks/types';
import { DeskAgent, type DeskAgentTab } from '@/screens';

// `tab` is left out of the URL for Agents. `agent` (the add or edit pane) and `page` belong to Agents only; any bad value
// falls back to its default (spec: tab navigation and URL).
const AgentSearch = PageSearch.extend({
  tab: z.enum(['github', 'limits', 'danger']).optional().catch(undefined),
  agent: z
    .union([z.literal('new'), z.uuid()])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/o/$org/p/$project/desk/agent')({
  staticData: { chrome: { mode: 'standard', scope: 'project', item: 'agent', crumb: 'Agent & settings', fill: true } },
  validateSearch: (search) => AgentSearch.parse(search),
  // Desk config is for roles that hold `agent:read` on this project; the guard runs before any loader.
  beforeLoad: ({ context: { queryClient }, params }) =>
    requireProjectPermission(queryClient, params.org, 'agent:read', params.project),
  component: DeskAgentPage,
});

type Trigger = { mode: TriggerMode; interval: PollInterval };

function DeskAgentPage() {
  const { org, project: projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const frame = useDeskFrame(org, projectId, now);
  // Delete project is an org-level permission: a project admin never sees it (the API refuses it anyway).
  const mayDelete = useCan(org, 'project:delete');
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: connection } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const mayUpdateAgents = useCan(org, 'agent:update', { projectId });

  // Each tab loads its own data: the agent list only while Agents is open, so one tab failing never blanks the page.
  // `?tab=danger` without `project:delete` shows Agents.
  const tab: DeskAgentTab = search.tab === 'danger' && !mayDelete ? 'agents' : (search.tab ?? 'agents');
  const agents = useAgentsTab({ org, projectId, page: pageOfSearch(search), enabled: tab === 'agents' });

  // The add and edit pane (`?agent=`) and the row actions. The pane belongs to the Agents tab only.
  const mayUpdateSecrets = useCan(org, 'secret:update', { projectId });
  const tester = useAgentTester(org, projectId);
  const closePane = () => void navigate({ search: (prev) => ({ ...prev, agent: undefined }) });
  const rowActions = useAgentRowActions(org, projectId, tester, {
    onRemoved: (id) => {
      if (search.agent === id) closePane();
    },
  });
  const { pane, busy: paneBusy } = useAgentPane({
    org,
    projectId,
    param: tab === 'agents' ? search.agent : undefined,
    mayUpdate: mayUpdateAgents,
    maySecret: mayUpdateSecrets,
    tester,
    onClose: closePane,
    onOpenAgent: (id) => void navigate({ search: (prev) => ({ ...prev, agent: id }), replace: true }),
  });
  // Focus: the pane takes it on open (Add agent puts it on the first provider card itself), Escape closes the pane
  // unless a save runs, and focus goes back to the control that opened it.
  const opener = useRef<HTMLElement | null>(null);
  const remember = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const paneOpen = pane !== undefined;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (paneOpen && !wasOpen.current && pane.mode !== 'add') {
      document.querySelector<HTMLElement>('aside[aria-labelledby] input:not([disabled])')?.focus();
    }
    if (!paneOpen && wasOpen.current && opener.current?.isConnected) opener.current.focus();
    wasOpen.current = paneOpen;
  }, [paneOpen, pane?.mode]);
  useEffect(() => {
    if (!paneOpen || paneBusy || rowActions.deleteDialog) return;
    const onKey = (e: KeyboardEvent) => {
      // A modal on top (the menu drawer below 1024px) takes the key: Escape closes it and the pane keeps what was typed.
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) closePane();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const limits = useSaveLimits(org, projectId, limitsOf(project), {
    onSaved: () => toast.show({ tone: 'ok', title: 'Limits saved' }),
  });

  // Trigger mode: the pick shows at once and is saved; while saves are in flight the latest pick shows, after a
  // failure the saved mode shows again with the problem title (spec §6). Every save settles through its own promise;
  // only the latest pick's outcome is shown, so an older save failing late never hides a newer pick.
  const saveTrigger = useSaveTrigger(org, projectId);
  const triggerSeq = useRef(0);
  const [picked, setPicked] = useState<Trigger>();
  const [triggerError, setTriggerError] = useState<string>();
  const onTriggerChange = (next: Trigger) => {
    const n = ++triggerSeq.current;
    setPicked(next);
    setTriggerError(undefined);
    const settle = (e?: unknown) => {
      if (n !== triggerSeq.current) return;
      setPicked(undefined);
      if (e !== undefined) setTriggerError(e instanceof ApiError ? e.title : 'Something went wrong. Try again.');
    };
    void saveTrigger
      .mutateAsync({
        triggerMode: next.mode,
        ...(next.mode === 'polling' && { pollIntervalSeconds: pollSeconds(next.interval) }),
      })
      .then(() => settle(), settle);
  };

  // Check now: one check at a time (the ref covers a second click before the pending state renders).
  const check = useCheckNow(org, projectId);
  const checking = useRef(false);
  const [checkNowError, setCheckNowError] = useState<string>();
  const onCheckNow = () => {
    if (checking.current) return;
    checking.current = true;
    setCheckNowError(undefined);
    check.mutate(undefined, {
      onSuccess: (after) => setCheckNowError(failedPollMessage(after)),
      onError: (e) => setCheckNowError(checkNowMessage(e)),
      onSettled: () => {
        checking.current = false;
      },
    });
  };

  const remove = useDeleteProject(org);
  const deleting = useRef(false);
  const onDeleteProject = () => {
    if (deleting.current) return;
    deleting.current = true;
    remove.mutate(projectId, {
      onSuccess: async () => {
        await navigate({ to: '/o/$org/projects', params: { org } });
        forgetProject(qc, org, projectId);
      },
      onError: (e) => toast.show(toastFromError(e)),
      onSettled: () => {
        deleting.current = false;
      },
    });
  };

  const heard = lastEvent(connection, now);
  const github = [
    { term: 'Repository', value: <span className="mono">{project.repoPath}</span> },
    {
      term: heard.mode === 'webhook' ? connectionCopy.lastEventTerm : connectionCopy.lastCheckedTerm,
      value: `${heard.at} (${heard.mode})`,
    },
  ];
  const saved: Trigger = { mode: project.triggerMode, interval: pollIntervalLabel(project.pollIntervalSeconds) };

  return (
    <DeskAgent
      frame={frame}
      tab={tab}
      onTabChange={(next) =>
        // Changing tab drops `agent` and `page`: the pane closes and nothing typed outlives it.
        void navigate({ search: { tab: next === 'agents' ? undefined : next } })
      }
      pane={pane}
      deleteDialog={rowActions.deleteDialog}
      agents={{
        ...agents,
        ...rowActions.actions,
        onAdd: () => {
          remember();
          void navigate({ search: (prev) => ({ ...prev, agent: 'new' }) });
        },
        onEdit: (row) => {
          remember();
          void navigate({ search: (prev) => ({ ...prev, agent: row.id }) });
        },
        readOnly: !mayUpdateAgents,
      }}
      limits={limitsOf(project)}
      github={github}
      trigger={picked ?? saved}
      pollInterval={saved.interval}
      onTriggerChange={onTriggerChange}
      triggerError={triggerError}
      onCheckNow={onCheckNow}
      checkingNow={check.isPending}
      checkNowError={checkNowError}
      onSaveLimits={(next) => void limits.save(next)}
      limitsErrors={limits.errors}
      limitsError={limits.formError}
      savingLimits={limits.saving}
      onDeleteProject={mayDelete ? onDeleteProject : undefined}
    />
  );
}

type AgentsTabList = Pick<AgentListProps, 'rows' | 'state' | 'onRetry' | 'pagination' | 'error'>;

/** The Agents tab's list: one page of agents, its paging, and its loading, empty and error states. */
function useAgentsTab({
  org,
  projectId,
  page,
  enabled,
}: {
  org: string;
  projectId: string;
  page: number;
  enabled: boolean;
}): AgentsTabList {
  const navigate = Route.useNavigate();
  const [pageSize] = usePageSize();
  const query = useQuery({
    ...deskQueries.agents(org, projectId, { page, pageSize }),
    placeholderData: keepPreviousData,
    enabled,
  });
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  const total = query.data?.total ?? 0;
  useClampToLastPage(page, pageSize, total, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: query.data?.page ?? page,
    pageSize: query.data?.pageSize,
    total,
    busy: query.isPlaceholderData,
    go,
  });
  const failed = query.isError && query.data === undefined;
  const state: AgentListProps['state'] = failed
    ? 'error'
    : query.data === undefined
      ? 'loading'
      : total === 0
        ? 'empty'
        : 'ready';
  return {
    rows: (query.data?.items ?? []).map(toAgentRowView),
    state,
    onRetry: () => void query.refetch(),
    pagination,
    ...(failed && query.error instanceof ApiError && query.error.requestId !== undefined
      ? { error: { requestId: query.error.requestId } }
      : {}),
  };
}
