import { z } from 'zod';

/** The setup routes in order. `repo` has no project yet; the rest match the server's `project.setupStep`. */
export const SETUP_STEPS = ['repo', 'agent', 'skills', 'rules', 'ready'] as const;

export const SetupStepParam = z.enum(SETUP_STEPS);
export type SetupStepParam = z.infer<typeof SetupStepParam>;

/** `/projects/new/$step` search: the project once step `repo` created it; a connection to preselect after install. */
export const SetupSearch = z.object({
  project: z.uuid().optional().catch(undefined),
  connection: z.uuid().optional().catch(undefined),
});
export type SetupSearch = z.infer<typeof SetupSearch>;

export const stepIndex = (step: SetupStepParam): number => SETUP_STEPS.indexOf(step);
