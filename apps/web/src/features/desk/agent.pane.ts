import { AGENT_TEST_MESSAGES, type AgentConnectionDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toastFromError } from '@/app/boundaries';
import { useToast } from '@/ds';
import type { AgentListProps, AgentPaneProps, DeleteAgentDialogProps } from '@/components';
import { toModelList, type ModelList } from '@/components/ModelPicker';
import { agentKindViews, agentPaneAgent, providerPickerChoices } from '@/mocks/agent';
import { useDeleteAgent, useReplaceCredential, useSaveAgent, useSetDefaultAgent, useTestAgent } from './agent.form';
import { agentsKey, deskQueries } from './queries';

// The Agents tab's writes: the add and edit pane and the row actions (test, set default, delete). The screens take
// plain props; these hooks hold the requests, the toasts and the dialog state. No typed secret is kept here: it only
// travels as an argument of the credential request (see `useSaveAgent`, `useReplaceCredential`).

const NO_LIST: ModelList = { models: [], state: { kind: 'fallback', reason: 'no_credential', host: null } };

/** Runs a connection test and says the result in a Toast: the fixed message for the status, never provider text. */
export function useAgentTester(org: string, projectId: string) {
  const toast = useToast();
  const test = useTestAgent(org, projectId);
  const [testingId, setTestingId] = useState<string>();
  const running = useRef(false);
  const run = async (agentId: string, name: string): Promise<AgentConnectionDto | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setTestingId(agentId);
    try {
      const answer = await test.mutateAsync(agentId);
      toast.show({
        tone: answer.status === 'ok' ? 'ok' : 'warn',
        title: AGENT_TEST_MESSAGES[answer.status],
        detail: name,
      });
      return answer;
    } catch (e) {
      toast.show(toastFromError(e));
      return undefined;
    } finally {
      running.current = false;
      setTestingId(undefined);
    }
  };
  return { run, testingId };
}
export type AgentTester = ReturnType<typeof useAgentTester>;

type Refusal =
  | { kind: 'rules'; count: number; command: string }
  | { kind: 'blocked'; title: string; text: string }
  | { kind: 'error'; title: string; requestId?: string };

type DeleteView = { id: string; name: string } & ({ kind: 'confirm' | 'deleting' } | Refusal);

const RULES = /^(\d+) rule(?:s|\(s\))? (?:names? it|uses? this agent): (.+?)\. (?:Point|Pick) /;
const RUNS = /^A run that is /;

/**
 * A refused delete → the dialog's reason. Every 409 is a Close-only refusal that shows the API's own sentence; the
 * patterns only pick the headline (and the rule commands). Anything else → the error banner with the problem title.
 */
function refusal(e: unknown): Refusal {
  if (!(e instanceof ApiError)) return { kind: 'error', title: 'Something went wrong. Try again.' };
  if (e.status === 409) {
    const text = e.detail ?? e.title;
    const rules = RULES.exec(text);
    if (rules?.[1] && rules[2]) return { kind: 'rules', count: Number(rules[1]), command: rules[2] };
    return {
      kind: 'blocked',
      title: RUNS.test(text) ? 'This agent has open runs' : 'This agent cannot be deleted',
      text,
    };
  }
  return { kind: 'error', title: e.title, ...(e.requestId !== undefined && { requestId: e.requestId }) };
}

function dialogOf(view: DeleteView, onKeep: () => void, onDelete: () => void): DeleteAgentDialogProps {
  const base = { name: view.name, onKeep, onDelete };
  switch (view.kind) {
    case 'confirm':
    case 'deleting':
      return { ...base, state: view.kind };
    case 'rules':
      return { ...base, state: 'blockedRules', rule: { count: view.count, command: view.command } };
    case 'blocked':
      return { ...base, state: 'blocked', reason: { title: view.title, text: view.text } };
    case 'error':
      return {
        ...base,
        state: 'error',
        error: { title: view.title, ...(view.requestId !== undefined && { requestId: view.requestId }) },
      };
  }
}

/** The list's row actions: Test connection, Set as default and Delete (with its confirmation dialog). */
export function useAgentRowActions(
  org: string,
  projectId: string,
  tester: AgentTester,
  { onRemoved }: { onRemoved(agentId: string): void },
) {
  const toast = useToast();
  const setDefault = useSetDefaultAgent(org, projectId);
  const remove = useDeleteAgent(org, projectId);
  const [busyId, setBusyId] = useState<string>();
  const [view, setView] = useState<DeleteView>();

  const onSetDefault = async (row: { id: string }) => {
    if (busyId !== undefined) return;
    setBusyId(row.id);
    try {
      await setDefault.mutateAsync(row.id);
      toast.show({ tone: 'ok', title: 'Default agent changed. New runs only.' });
    } catch (e) {
      toast.show(toastFromError(e));
    } finally {
      setBusyId(undefined);
    }
  };

  const confirmDelete = async () => {
    if (!view || view.kind === 'deleting' || remove.isPending) return;
    const { id, name } = view;
    setView({ id, name, kind: 'deleting' });
    try {
      await remove.mutateAsync(id);
      setView(undefined);
      toast.show({ tone: 'ok', title: 'Agent deleted' });
      onRemoved(id);
    } catch (e) {
      setView({ id, name, ...refusal(e) });
    }
  };

  const actions: Pick<AgentListProps, 'onTest' | 'onSetDefault' | 'onDelete' | 'busyId' | 'testingId'> = {
    onTest: (row) => void tester.run(row.id, row.name),
    onSetDefault: (row) => void onSetDefault(row),
    onDelete: (row) => setView({ id: row.id, name: row.name, kind: 'confirm' }),
    busyId,
    testingId: tester.testingId,
  };
  const deleteDialog = view
    ? dialogOf(
        view,
        () => {
          if (view.kind !== 'deleting') setView(undefined);
        },
        () => void confirmDelete(),
      )
    : undefined;
  return { actions, deleteDialog };
}

export interface AgentPaneArgs {
  org: string;
  projectId: string;
  /** The `?agent=` value: `'new'`, an agent id, or nothing (no pane). */
  param: string | undefined;
  /** `agent:update` on this project: without it the pane is read-only. */
  mayUpdate: boolean;
  /** `secret:update`: without it the credential cannot be replaced. */
  maySecret: boolean;
  tester: AgentTester;
  onClose(): void;
  /** Switches the pane to this agent (the add pane after create worked and the credential did not). */
  onOpenAgent(agentId: string): void;
}

/** The props of the add, edit or view pane, or undefined while none is open (or the agent is still loading). */
export function useAgentPane({
  org,
  projectId,
  param,
  mayUpdate,
  maySecret,
  tester,
  onClose,
  onOpenAgent,
}: AgentPaneArgs): { pane: AgentPaneProps | undefined; busy: boolean } {
  const toast = useToast();
  const qc = useQueryClient();
  const saver = useSaveAgent(org, projectId);
  const isAdd = param === 'new';
  const editId = param !== undefined && !isAdd ? param : undefined;
  const replace = useReplaceCredential(org, projectId, editId);
  const setDefault = useSetDefaultAgent(org, projectId);

  // A different pane starts clean; going from the add pane to the agent it just created keeps the partial banner.
  const [seen, setSeen] = useState(param);
  if (seen !== param) {
    setSeen(param);
    if (saver.partial?.agentId !== param) saver.reset();
    replace.reset();
  }

  const agents = useQuery({ ...deskQueries.allAgents(org, projectId), enabled: editId !== undefined });
  const saved = agents.data?.items.find((a) => a.id === editId);
  const models = useQuery({
    ...deskQueries.agentModels(org, editId ?? ''),
    enabled: editId !== undefined && saved !== undefined,
  });

  const close = () => {
    saver.reset();
    replace.reset();
    onClose();
  };
  const busy = saver.saving || replace.pending;

  if (param === undefined || (isAdd && !mayUpdate)) return { pane: undefined, busy };
  const common = { kinds: agentKindViews, providers: providerPickerChoices, onClose: close };

  if (isAdd) {
    const onSubmit: AgentPaneProps['onSubmit'] = (values) => {
      void saver.add(values).then((result) => {
        if (result.ok) {
          toast.show({ tone: 'ok', title: 'Agent saved' });
          if (result.defaultError !== undefined) toast.show({ tone: 'err', title: result.defaultError });
          close();
        } else if (result.agentId !== undefined) onOpenAgent(result.agentId);
        else if (result.error !== undefined) toast.show({ tone: 'err', title: result.error });
      });
    };
    return {
      busy,
      pane: {
        ...common,
        mode: 'add',
        modelList: NO_LIST,
        onSubmit,
        saving: saver.saving,
        progress: saver.progress,
        fieldErrors: saver.fieldErrors,
        canReplaceCredential: maySecret,
      },
    };
  }

  // The agent list is (re)loading: show nothing yet rather than "no longer exists".
  if (saved === undefined && (agents.data === undefined || agents.isFetching)) return { pane: undefined, busy };
  if (saved === undefined) {
    return { busy, pane: { ...common, mode: 'edit', modelList: NO_LIST, gone: true } };
  }

  const agent = agentPaneAgent(saved);
  const onSubmit: AgentPaneProps['onSubmit'] = (values) => {
    void saver.edit(agent, values).then((result) => {
      if (result.error !== undefined) toast.show({ tone: 'err', title: result.error });
      if (!result.ok) return;
      toast.show(
        result.defaultChanged
          ? { tone: 'ok', title: 'Default agent changed. New runs only.' }
          : { tone: 'ok', title: 'Agent saved' },
      );
      close();
    });
  };
  const onReplaceCredential: AgentPaneProps['onReplaceCredential'] = async (credential, { makeDefault }) => {
    const afterPartialAdd = saver.partial?.agentId === saved.id;
    const done = await replace.replace(credential.type, credential.value, credential.baseUrl);
    // The pane reads the agent from the list: refresh it after any attempt (a failed write after an address change
    // leaves the new address with no credential).
    await qc.invalidateQueries({ queryKey: agentsKey(org, projectId) });
    if (done) {
      saver.clearPartial();
      // The add that left this agent without a credential skipped the default tick: honour it now.
      if (afterPartialAdd && makeDefault && !saved.isDefault) {
        try {
          await setDefault.mutateAsync(saved.id);
          toast.show({ tone: 'ok', title: 'Default agent changed. New runs only.' });
        } catch (e) {
          toast.show(toastFromError(e));
        }
      }
      // Saving the credential also tests it; the result shows in a Toast and in the row.
      await tester.run(saved.id, saved.name);
    }
    return done;
  };
  return {
    busy,
    pane: {
      ...common,
      mode: mayUpdate ? 'edit' : 'view',
      agent,
      modelList: toModelList(models, saved.baseUrl),
      onSubmit,
      onReplaceCredential,
      onTest: () => void tester.run(saved.id, saved.name),
      saving: busy,
      progress: saver.progress,
      testing: tester.testingId === saved.id,
      fieldErrors: {
        ...saver.fieldErrors,
        ...(replace.addressError !== undefined && { baseUrl: replace.addressError }),
      },
      credentialError: replace.error,
      ...(saver.partial?.agentId === saved.id && { partial: saver.partial, draft: saver.partial.draft }),
      canReplaceCredential: mayUpdate && maySecret,
    },
  };
}
