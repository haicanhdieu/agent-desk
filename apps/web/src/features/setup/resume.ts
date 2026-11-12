import type { ProjectDto } from '@agentdesk/contracts';
import { stepIndex, type SetupStepParam } from './steps';

/**
 * The step to show for a requested one, from the server's state only: with no project every step is `repo`; a step
 * later than the project's `setupStep` (the furthest unfinished one) becomes that step; earlier steps stay open.
 */
export function resolveStep(requested: SetupStepParam, project: Pick<ProjectDto, 'setupStep'> | null): SetupStepParam {
  if (!project) return 'repo';
  return stepIndex(requested) > stepIndex(project.setupStep) ? project.setupStep : requested;
}
