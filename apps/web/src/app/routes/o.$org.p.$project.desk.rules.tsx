import type { AgentDto, RuleDto } from '@agentdesk/contracts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { projectPaths, useDeskFrame } from '@/features/desk/frame';
import { toRule } from '@/features/desk/map';
import { useDeleteRule, useToggleRule } from '@/features/desk/mutations';
import { deskQueries } from '@/features/desk/queries';
import { useRuleForm } from '@/features/desk/rules.form';
import { projectsQueries } from '@/features/projects/queries';
import { DeskRules, RulePane } from '@/screens';

/** `rule`: `new` opens the create form, a rule id opens that rule; anything else opens nothing. */
const RulesSearch = z.object({
  rule: z
    .union([z.literal('new'), z.uuid()])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/o/$org/p/$project/desk/rules')({
  validateSearch: (search) => RulesSearch.parse(search),
  loader: async ({ context: { queryClient }, params: { org, project } }) => {
    await Promise.all([
      queryClient.ensureQueryData(deskQueries.rules(org, project)),
      queryClient.ensureQueryData(deskQueries.skills(org, project)),
      queryClient.ensureQueryData(deskQueries.agent(org, project)),
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
  const { data: ruleDtos } = useSuspenseQuery(deskQueries.rules(org, projectId));
  const { data: skillDtos } = useSuspenseQuery(deskQueries.skills(org, projectId));
  const { data: agent } = useSuspenseQuery(deskQueries.agent(org, projectId));
  const toggle = useToggleRule(org, projectId, {
    onError: (e) => toast.show(toastFromError(e)),
  });
  const remove = useDeleteRule(org, projectId);

  const skillNames = skillDtos.map((s) => s.name);
  const rules = ruleDtos.map((r) => toRule(r, agent, now, skillNames));
  const editing = search.rule === undefined ? undefined : ruleDtos.find((r) => r.id === search.rule);
  const creating = search.rule === 'new';
  const paths = projectPaths(org, projectId);

  const open = (rule: string) => void navigate({ search: { rule } });
  const close = () => void navigate({ search: {} });
  const onDelete = (id: string) =>
    remove.mutate(id, {
      onSuccess: close,
      onError: (e) => toast.show(toastFromError(e)),
    });

  return (
    <DeskRules
      frame={frame}
      rules={rules}
      skills={skillNames}
      editingId={editing?.id}
      maxRunsPerTicket={project.maxRunsPerTicket}
      guardLinks={{ change: paths.agent, ignored: paths.runs }}
      onToggle={(id, enabled) => toggle.mutate({ id, enabled })}
      onCreate={() => open('new')}
      onEdit={open}
      form={
        creating || editing ? (
          <RuleEditor
            // A fresh form per rule: switching rules starts from that rule's saved values.
            key={editing?.id ?? 'new'}
            org={org}
            projectId={projectId}
            rule={editing}
            agent={agent}
            skills={skillNames}
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
  agent: AgentDto;
  skills: string[];
  onClose(): void;
  onDelete?(): void;
}

function RuleEditor({ org, projectId, rule, agent, skills, onClose, onDelete }: RuleEditorProps) {
  const form = useRuleForm(org, projectId, {
    initial: rule,
    defaultSkill: skills[0],
    onSaved: onClose,
  });
  const { values } = form;
  return (
    <RulePane
      title={rule ? 'Edit rule' : 'New rule'}
      value={{
        command: values.command,
        target: values.target,
        labels: values.labelFilter,
        skill: values.skillName,
        agent: agent.name,
        enabled: values.enabled,
      }}
      skills={skills}
      agentModel={agent.model}
      onChange={(d) =>
        form.change({
          command: d.command,
          labelFilter: d.labels,
          target: d.target,
          skillName: d.skill,
          enabled: d.enabled,
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
