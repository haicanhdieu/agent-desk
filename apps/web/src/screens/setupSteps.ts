import type { StepperProps } from '@/components';

export interface SetupStepDetails {
  repo?: string;
  credential?: string;
  skills?: string;
}

/** The four setup steps; `detail` only shows once a step is done. */
export function setupSteps({ repo, credential, skills }: SetupStepDetails = {}): StepperProps['steps'] {
  return [
    { label: 'Connect repository', detail: repo },
    { label: 'Add Claude credential', detail: credential },
    { label: 'Add skills', optional: true, detail: skills },
    { label: 'Add first rule' },
  ];
}

export const DEFAULT_CREDENTIAL_DETAIL = 'Claude Code token, opus';

export interface SetupNav {
  backHref?: string;
  nextHref?: string;
  skipHref?: string;
}

/** Setup 3 primary button. 0 selected reads "Continue" (nothing to commit; Skip stays), 1 is singular. */
export const commitLabel = (n: number) => (n === 0 ? 'Continue' : `Commit ${n} skill${n === 1 ? '' : 's'} and continue`);
