/**
 * Activities of SetupTestWorkflow. The setup script body and the workspace token never appear in an argument or a
 * result: the script is read from `setup_tests.script_body` inside the activity and the token goes straight into the
 * Job's Secret.
 */
export interface SetupTestRef {
  orgId: string;
  setupTestId: string;
}

/** The setup result the logs reported; `null` when the pod ended (or the test was ended) before any result marker. */
export type SetupTestResult = { status: 'passed' | 'failed' } | null;

export interface SetupTestActivities {
  /** Mints the token, creates the Secret (clone URL + runEnv, no agent credential) and the Job, sets `running`. */
  createSetupTestJob(ref: SetupTestRef): Promise<{ ttlSeconds: number }>;
  /** Stores setup events and the result; returns at the setup result marker or when the pod has exited. */
  followSetupTestLogs(ref: SetupTestRef): Promise<SetupTestResult>;
  /** Deletes the Job and Secret, sets `ended_at`, clears `script_body`; status `ended` if there was no result. Idempotent. */
  finalizeSetupTest(ref: SetupTestRef): Promise<void>;
}
