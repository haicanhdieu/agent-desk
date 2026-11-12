import { Button, CommandChip, StatusBadge, TicketRef } from '@/ds';
import { Brand, StepLine, StepList } from '@/components';
import styles from './Screens.module.css';

export interface SignInProps {
  signInHref: string;
  /** Starts the sign-in in script (the app's GitHub social sign-in); the link stays the no-script fallback. */
  onSignIn?: () => void;
}

export function SignIn({ signInHref, onSignIn }: SignInProps) {
  return (
    <main className={styles.signIn}>
      <div className={styles.signInLeft}>
        <Brand size={26} />
        <div className={styles.signInCopy}>
          <h1>Hand GitHub issues to Claude Code, and watch every run live.</h1>
          <p className={`muted ${styles.lead}`}>
            Comment a command on an issue. Agent Desk starts the matching skill in its own container, links the run
            back to the ticket, and lets you step into the terminal when the agent needs you.
          </p>
          <div className={styles.cta}>
            <Button
              variant="primary"
              size="lg"
              icon="github"
              href={signInHref}
              onClick={onSignIn && ((e) => { e.preventDefault(); onSignIn(); })}
            >
              Sign in with GitHub
            </Button>
            <p className={`faint ${styles.privacy}`}>
              We read your GitHub login and the repositories you install the app on. Nothing else.
            </p>
          </div>
        </div>
        <p className={`faint ${styles.poc}`}>Proof of concept. Single user per project.</p>
      </div>
      <section className={styles.signInRight} aria-labelledby="two-runs">
        <p id="two-runs" className={`muted ${styles.kicker}`}>One ticket, two runs</p>
        <StepList
          items={[
            <>
              <span>You comment <CommandChip>/code-build</CommandChip> on</span>
              <StepLine>
                <TicketRef kind="issue" number={142} />
                <b style={{ fontWeight: 600 }}>Export invoices as CSV from the billing page</b>
              </StepLine>
            </>,
            <StepLine>
              <StatusBadge status="running" />
              <span className="muted">Run 60 builds the feature and opens</span>
              <TicketRef kind="pr" number={148} />
            </StepLine>,
            <span>The agent comments <CommandChip>/code-review</CommandChip> on the PR, which starts the next run</span>,
            <StepLine>
              <StatusBadge status="idle" variant="pill">Needs you</StatusBadge>
              <span className="muted">Run 62 asks you one question in the terminal</span>
            </StepLine>,
          ]}
        />
      </section>
    </main>
  );
}
