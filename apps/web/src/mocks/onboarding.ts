import type { ChecklistStep } from './types';

const wizard = '/o/acme/projects/new/repo';
const agent = '/o/acme/p/p1/desk/agent';
const rules = '/o/acme/p/p1/desk/rules';

const step = (key: ChecklistStep['key'], label: string, done: boolean, href: string): ChecklistStep => ({
  key,
  label,
  done,
  href,
});

export const checklistSteps: Record<'none' | 'partial' | 'complete', ChecklistStep[]> = {
  none: [
    step('connect_code_host', 'Connect a code host', false, wizard),
    step('create_project', 'Create a project', false, wizard),
    step('add_agent', 'Add an agent', false, wizard),
    step('add_rule', 'Add a rule', false, wizard),
  ],
  partial: [
    step('connect_code_host', 'Connect a code host', true, wizard),
    step('create_project', 'Create a project', true, wizard),
    step('add_agent', 'Add an agent', false, agent),
    step('add_rule', 'Add a rule', false, rules),
  ],
  complete: [
    step('connect_code_host', 'Connect a code host', true, wizard),
    step('create_project', 'Create a project', true, wizard),
    step('add_agent', 'Add an agent', true, agent),
    step('add_rule', 'Add a rule', true, rules),
  ],
};

export const pendingInvitationsCount = 2;
