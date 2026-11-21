import { queryOptions } from '@tanstack/react-query';
import type { OrgChecklistDto } from '@agentdesk/contracts';
import type { ChecklistStep, ChecklistStepKey } from '@/mocks/types';
import { api } from '../api';

/** The first-run checklist of one org; invalidated when a step is completed. */
export const checklistKey = (org: string) => ['org', org, 'checklist'] as const;

/** Only org-scope `project:create` holders may read it: callers fetch it for them alone. */
export const checklistQuery = (org: string, orgId: string) =>
  queryOptions({
    queryKey: checklistKey(org),
    queryFn: (): Promise<OrgChecklistDto> => api.orgs.checklist({ params: { orgId } }),
  });

const LABELS: Record<ChecklistStepKey, string> = {
  connect_code_host: 'Connect a code host',
  create_project: 'Create a project',
  add_agent: 'Add an agent',
  add_rule: 'Add a rule',
};

/** DTO to the card's rows: labels from the spec, "Start" opens the focus project's step or the wizard when none. */
export function toChecklistSteps(dto: OrgChecklistDto, org: string): ChecklistStep[] {
  const orgPath = `/o/${encodeURIComponent(org)}`;
  const wizard = `${orgPath}/projects/new/repo`;
  const project = dto.projectId === null ? null : `${orgPath}/p/${encodeURIComponent(dto.projectId)}`;
  const hrefs: Record<ChecklistStepKey, string> = {
    connect_code_host: wizard,
    create_project: wizard,
    add_agent: project === null ? wizard : `${project}/desk/agent`,
    add_rule: project === null ? wizard : `${project}/desk/rules`,
  };
  return dto.steps.map((s) => ({ key: s.key, label: LABELS[s.key], done: s.done, href: hrefs[s.key] }));
}
