import type { StepperProps } from '@/components';

export interface SetupStepDetails {
  repo?: string;
  credential?: string;
  skills?: string;
  /** Adds the optional "Prepare workspace" step after the credential (five steps); every setup screen passes it. */
  withWorkspace?: boolean;
  workspace?: string;
}

/** The setup steps (four, or five `withWorkspace`); `detail` only shows once a step is done. */
export function setupSteps({
  repo,
  credential,
  skills,
  withWorkspace,
  workspace,
}: SetupStepDetails = {}): StepperProps['steps'] {
  return [
    { label: 'Connect repository', detail: repo },
    { label: 'Add Claude credential', detail: credential },
    ...(withWorkspace ? [{ label: 'Prepare workspace', optional: true, detail: workspace }] : []),
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
export const commitLabel = (n: number) =>
  n === 0 ? 'Continue' : `Commit ${n} skill${n === 1 ? '' : 's'} and continue`;
