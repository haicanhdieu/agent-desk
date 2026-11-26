import type { AgentDto, RuleDto } from '@agentdesk/contracts';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import {
  PageSearch,
  loadPage,
  pageOfSearch,
  pageToSearch,
  readPageSize,
  useClampToLastPage,
  usePageSize,
  usePagedQuery,
  usePaginationProps,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { requireProjectPermission } from '@/features/access/guards';
import { projectPaths, useDeskFrame, useDeskRights } from '@/features/desk/frame';
import { UNAVAILABLE_AGENT, toRule, toRuleAgentOption } from '@/features/desk/map';
import { useDeleteRule, useToggleRule } from '@/features/desk/mutations';
import { deskQueries } from '@/features/desk/queries';
import { skillFoldersOf } from '@/features/desk/skillFolders';
import { usePromptPreview } from '@/features/desk/promptPreview';
import { useRuleForm } from '@/features/desk/rules.form';
import { projectsQueries } from '@/features/projects/queries';
import { toModelList } from '@/components';
import { DeskRules, RulePane } from '@/screens';

/** `rule`: `new` opens the create form, a rule id opens that rule; anything else opens nothing. */
const RulesSearch = z.object({
  ...PageSearch.shape,
  rule: z
    .union([z.literal('new'), z.uuid()])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/o/$org/p/$project/desk/rules')({
  validateSearch: (search) => RulesSearch.parse(search),
  loaderDeps: ({ search }) => ({ page: pageOfSearch(search) }),
  // Desk config is for roles that hold `rule:read` on this project; the guard runs before any loader.
  beforeLoad: ({ context: { queryClient }, params }) =>
    requireProjectPermission(queryClient, params.org, 'rule:read', params.project),
  loader: async ({ context: { queryClient }, params: { org, project }, deps: { page }, cause }) => {
    await Promise.all([
      loadPage(queryClient, deskQueries.rules(org, project, { page, pageSize: readPageSize() }), cause),
      queryClient.ensureQueryData(deskQueries.allSkills(org, project)),
    ]);
  },
  component: DeskRulesPage,
});

function DeskRulesPage() {
  const { org, project: projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const toast = useToast();
  const now = useNow();
  const frame = useDeskFrame(org, projectId, now);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const current = pageOfSearch(search);
  const [pageSize] = usePageSize();
  const { data: rulesPage, busy } = usePagedQuery({ page: current, pageSize }, (q) =>
    deskQueries.rules(org, projectId, q),
  );
  const ruleDtos = rulesPage.items;
  const { data: skillsPage } = useSuspenseQuery(deskQueries.allSkills(org, projectId));
  // The agent list needs `agent:read`; without it the rows show no agent name and the form keeps each rule's agent.
  const rights = useDeskRights(org, projectId);
  const agentList = useQuery({ ...deskQueries.allAgents(org, projectId), enabled: rights.agent });
  const agents = agentList.data?.items ?? [];
  const agentsState = !rights.agent || agentList.isError ? 'locked' : agentList.data ? 'ready' : 'loading';
  const toggle = useToggleRule(org, projectId, {
    onError: (e) => toast.show(toastFromError(e)),
  });
  const remove = useDeleteRule(org, projectId);

  const skillNames = skillsPage.items.map((s) => s.name);
  const folders = agentsState === 'ready' ? skillFoldersOf(agents) : undefined;
  const rules = ruleDtos.map((r) =>
    toRule(r, agentsState === 'loading' ? undefined : agents, now, skillNames, folders),
  );
  const onPage = search.rule === undefined ? undefined : ruleDtos.find((r) => r.id === search.rule);
  // A rule linked from another page opens from the whole-set read (read only when the link needs it).
  const { data: wholeSet } = useQuery({
    ...deskQueries.allRules(org, projectId),
    enabled: search.rule !== undefined && search.rule !== 'new' && onPage === undefined,
  });
  const editing = onPage ?? (search.rule === undefined ? undefined : wholeSet?.items.find((r) => r.id === search.rule));
  const creating = search.rule === 'new';
  const paths = projectPaths(org, projectId);

  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  useClampToLastPage(current, rulesPage.pageSize, rulesPage.total, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: rulesPage.page,
    pageSize: rulesPage.pageSize,
    total: rulesPage.total,
    busy,
    go,
  });
  const open = (rule: string) => void navigate({ search: (prev) => ({ ...prev, rule }) });
  const close = () => void navigate({ search: (prev) => ({ ...prev, rule: undefined }) });
  const onDelete = (id: string) =>
    remove.mutate(id, {
      // Only the deleted rule's own pane closes; another open rule or the new form stays.
      onSuccess: () => {
        if (search.rule === id) close();
      },
      onError: (e) => toast.show(toastFromError(e)),
    });

  return (
    <DeskRules
      height="viewport"
      frame={frame}
      rules={rules}
      pagination={pagination}
      skills={skillNames}
      editingId={editing?.id}
      maxRunsPerTicket={project.maxRunsPerTicket}
      guardLinks={{ change: `${paths.agent}?tab=limits`, ignored: paths.runs }}
      onToggle={(id, enabled) => toggle.mutate({ id, enabled })}
      onCreate={() => open('new')}
      onEdit={open}
      onDelete={onDelete}
      form={
        creating || editing ? (
          <RuleEditor
            // A fresh form per rule: switching rules starts from that rule's saved values.
            key={editing?.id ?? 'new'}
            org={org}
            projectId={projectId}
            rule={editing}
            agents={agents}
            agentsState={agentsState}
            skills={skillNames}
            skillFolders={folders}
            onClose={close}
            onDelete={editing && (() => onDelete(editing.id))}
          />
        ) : undefined
      }
    />
  );
}

interface RuleEditorProps {
  org: string;
  projectId: string;
  /** The rule to edit; none creates one. */
  rule?: RuleDto;
  agents: AgentDto[];
  /** `locked`: the reader cannot see the agent list (or it failed): each rule keeps its agent. */
  agentsState: 'ready' | 'loading' | 'locked';
  skills: string[];
  skillFolders: string[] | undefined;
  onClose(): void;
  onDelete?(): void;
}

function RuleEditor({
  org,
  projectId,
  rule,
  agents,
  agentsState,
  skills,
  skillFolders,
  onClose,
  onDelete,
}: RuleEditorProps) {
  const form = useRuleForm(org, projectId, {
    initial: rule,
    defaultSkill: skills[0],
    onSaved: onClose,
  });
  const { values } = form;
  const promptPreview = usePromptPreview(org, projectId, true);
  // A rule with no agent follows the default one, so its model list and default model are that agent's.
  const defaultAgent = agents.find((a) => a.isDefault);
  const chosen = values.agentId === null ? defaultAgent : agents.find((a) => a.id === values.agentId);
  const models = useQuery({ ...deskQueries.agentModels(org, chosen?.id ?? ''), enabled: chosen !== undefined });
  return (
    <RulePane
      title={rule ? 'Edit rule' : 'New rule'}
      value={{
        command: values.command,
        target: values.target,
        labels: values.labelFilter,
        skill: values.skillName,
        agentId: values.agentId,
        agentLabel: chosen?.name ?? (values.agentId === null ? undefined : UNAVAILABLE_AGENT),
        enabled: values.enabled,
        kind: values.kind,
        prompt: values.prompt,
        model: values.model,
      }}
      modelField={
        chosen && {
          list: toModelList(models, chosen.baseUrl),
          defaultModel: chosen.model,
          settingsHref: projectPaths(org, projectId).agent,
        }
      }
      agents={agentsState === 'locked' ? undefined : agents.map(toRuleAgentOption)}
      defaultAgentName={defaultAgent?.name}
      agentsState={agentsState === 'loading' ? 'loading' : 'ready'}
      skills={skills}
      skillFolders={skillFolders}
      promptPreview={promptPreview}
      onChange={(d) =>
        form.change({
          kind: d.kind ?? 'skill',
          prompt: d.prompt ?? '',
          command: d.command,
          labelFilter: d.labels,
          target: d.target,
          skillName: d.skill,
          enabled: d.enabled,
          agentId: d.agentId,
          model: d.model ?? null,
        })
      }
      onClose={onClose}
      onSave={form.submit}
      onDelete={onDelete}
      errors={form.errors}
      formError={form.formError}
      saving={form.submitting}
    />
  );
}
