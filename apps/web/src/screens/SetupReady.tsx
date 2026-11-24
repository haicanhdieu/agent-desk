import type { ReactNode } from 'react';
import { Banner, Button, Icon, InlineStatus, LabelChip, StatusIcon } from '@/ds';
import { CodeBlock, KeyValue, SetupLayout } from '@/components';
import { connectionCopy as c } from '@/mocks/connection';
import type { Actor, TriggerMode } from '@/mocks/types';
import type { OrgSwitchProps } from '@/components';
import { DEFAULT_CREDENTIAL_DETAIL, setupSteps } from './setupSteps';
import styles from './Screens.module.css';

export interface SetupReadyProps {
  user: Actor;
  /** The org crumb and menu in the top bar. */
  org?: OrgSwitchProps;
  projectName: string;
  repo: string;
  /** The label the first rule needs, if any. */
  label?: { name: string; color?: string };
  /** The comment that triggers the first rule. Absent when setup finished without a rule. */
  command?: string;
  summary: { term: string; value: ReactNode }[];
  /** What was heard last: a webhook delivery, or the last polling check. */
  lastEvent: { mode: TriggerMode; at: string };
  skills?: string;
  credentialDetail?: string;
  issuesHref?: string;
  runsHref?: string;
  /** Where to add a rule later; shown when there is no rule yet. */
  rulesHref?: string;
  /** False hides the Add a rule action (the viewer cannot create rules). Display only: the API decides. */
  canAddRule?: boolean;
  /** Workspace setup warning (warn, don't block): the project still goes live. */
  warning?: { title: string; detail: string; href?: string };
}

export function SetupReady({
  user,
  org,
  projectName,
  repo,
  label,
  command,
  summary,
  lastEvent,
  skills = 'code-build, code-review',
  credentialDetail = DEFAULT_CREDENTIAL_DETAIL,
  issuesHref = `https://github.com/${repo}/issues`,
  runsHref = '#',
  rulesHref = '#',
  canAddRule = true,
  warning,
}: SetupReadyProps) {
  return (
    <SetupLayout
      user={user}
      org={org}
      projectName={projectName}
      steps={setupSteps({ repo, credential: credentialDetail, skills, withWorkspace: true })}
      current={5}
      ready="Ready to trigger"
      header={
        <div className={styles.readyHead}>
          <InlineStatus tone="ok" icon={<StatusIcon status="succeeded" size={16} />}>
            Project ready
          </InlineStatus>
          {command ? (
            <>
              <h1 className={styles.readyTitle}>Trigger your first run from GitHub</h1>
              <p className={`muted ${styles.readyIntro}`}>
                Open or create an issue in <span className="mono">{repo}</span>, add the label, and post this comment:
              </p>
            </>
          ) : (
            <>
              <h1 className={styles.readyTitle}>Add a rule to trigger runs</h1>
              <p className={`muted ${styles.readyIntro}`}>
                Nothing in <span className="mono">{repo}</span> can start a run until a rule maps a comment command to a
                skill or prompt.
              </p>
            </>
          )}
        </div>
      }
    >
      {warning && (
        <Banner
          tone="warn"
          icon={<Icon name="warning" size={16} />}
          title={warning.title}
          centered
          actions={
            warning.href ? (
              <Button size="sm" href={warning.href}>
                Open workspace setup
              </Button>
            ) : undefined
          }
        >
          {warning.detail}
        </Banner>
      )}
      {command ? (
        <CodeBlock
          caption={
            label ? (
              <>
                Comment on an issue labelled <LabelChip name={label.name} color={label.color} />
              </>
            ) : (
              'Comment on an issue'
            )
          }
          code={command}
          onCopy={() => {
            void navigator.clipboard?.writeText(command);
          }}
        />
      ) : (
        <Banner tone="off" icon={<Icon name="warning" size={16} />} title="No rule yet">
          You skipped this step. Add a rule to let a comment command start a run.
        </Banner>
      )}
      <div className={styles.actions}>
        {command ? (
          <Button variant="primary" icon="external" href={issuesHref}>
            Open issues in GitHub
          </Button>
        ) : (
          canAddRule && (
            <Button variant="primary" href={rulesHref}>
              Add a rule
            </Button>
          )
        )}
        <Button href={runsHref}>Go to runs</Button>
      </div>
      <Banner tone="off" icon={<StatusIcon status="starting" size={16} />} iconColor="var(--run)">
        <b className={styles.semi}>{c.listeningTitle}</b> {c.listeningBody}{' '}
        {lastEvent.mode === 'webhook' ? c.lastEvent(lastEvent.at) : c.lastChecked(lastEvent.at)}.
      </Banner>
      <div className={styles.summaryBlock}>
        <h2 className="h3">What you set up</h2>
        <KeyValue items={summary} termWidth={120} />
      </div>
    </SetupLayout>
  );
}
