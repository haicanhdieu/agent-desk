import type { ReactNode } from 'react';
import { Banner, Button, InlineStatus, LabelChip, StatusIcon } from '@/ds';
import { CodeBlock, KeyValue, SetupLayout } from '@/components';
import type { Actor } from '@/mocks/types';
import { DEFAULT_CREDENTIAL_DETAIL, setupSteps } from './setupSteps';
import styles from './Screens.module.css';

export interface SetupReadyProps {
  user: Actor;
  projectName: string;
  repo: string;
  label: { name: string; color: string };
  command: string;
  summary: { term: string; value: ReactNode }[];
  lastWebhook: string;
  skills?: string;
  credentialDetail?: string;
  issuesHref?: string;
  runsHref?: string;
}

export function SetupReady({
  user, projectName, repo, label, command, summary, lastWebhook, skills = 'code-build, code-review',
  credentialDetail = DEFAULT_CREDENTIAL_DETAIL, issuesHref = `https://github.com/${repo}/issues`, runsHref = '#',
}: SetupReadyProps) {
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps({ repo, credential: credentialDetail, skills })}
      current={4}
      ready="Ready to trigger"
      header={
        <div className={styles.readyHead}>
          <InlineStatus tone="ok" icon={<StatusIcon status="succeeded" size={16} />}>Project ready</InlineStatus>
          <h1 className={styles.readyTitle}>Trigger your first run from GitHub</h1>
          <p className={`muted ${styles.readyIntro}`}>
            Open or create an issue in <span className="mono">{repo}</span>, add the label, and post this comment:
          </p>
        </div>
      }
    >
      <CodeBlock
        caption={<>Comment on an issue labelled <LabelChip name={label.name} color={label.color} /></>}
        code={command}
        onCopy={() => { void navigator.clipboard?.writeText(command); }}
      />
      <div className={styles.actions}>
        <Button variant="primary" icon="external" href={issuesHref}>Open issues in GitHub</Button>
        <Button href={runsHref}>Go to runs</Button>
      </div>
      <Banner tone="off" icon={<StatusIcon status="starting" size={16} />} iconColor="var(--run)">
        <b className={styles.semi}>Listening for your first command</b> This page opens the run as soon as it starts. Last webhook: {lastWebhook}.
      </Banner>
      <div className={styles.summaryBlock}>
        <h2 className="h3">What you set up</h2>
        <KeyValue items={summary} termWidth={120} />
      </div>
    </SetupLayout>
  );
}
