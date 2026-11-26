import { Banner, Button, Dialog, Icon } from '@/ds';
import styles from './AgentList.module.css';

interface DeleteAgentDialogBase {
  name: string;
  onKeep: () => void;
  onDelete: () => void;
}

export type DeleteAgentDialogProps = DeleteAgentDialogBase &
  (
    | { state: 'confirm' | 'deleting' }
    /** `blockedRules`: how many rules name the agent and the first command. */
    | { state: 'blockedRules'; rule: { count: number; command: string } }
    /** `blocked`: any other refusal (409): the headline and the API's own sentence. */
    | { state: 'blocked'; reason: { title: string; text: string } }
    /** `error`: the problem title and the request id. */
    | { state: 'error'; error: { title: string; requestId?: string } }
  );

/** Confirm deleting one agent, or say why it cannot be deleted. Always open: mount it while it is wanted. Text only. */
export function DeleteAgentDialog(props: DeleteAgentDialogProps) {
  const { state, name, onKeep, onDelete } = props;
  const deleting = state === 'deleting';
  const blocked = state === 'blockedRules' || state === 'blocked';
  return (
    <Dialog
      open
      title={`Delete agent ${name}?`}
      onClose={deleting ? () => undefined : onKeep}
      footer={
        blocked ? (
          <Button onClick={onKeep}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" disabled={deleting} onClick={onKeep}>
              Keep agent
            </Button>
            <Button
              variant="solid-danger"
              icon="trash"
              disabled={deleting}
              aria-busy={deleting || undefined}
              onClick={onDelete}
            >
              {deleting ? 'Deleting…' : 'Delete agent'}
            </Button>
          </>
        )
      }
    >
      <div className={styles.dialogBody}>
        <p className={styles.dialogText}>Rules and runs stop using it. Run history keeps its name.</p>
        {props.state === 'blockedRules' && (
          <Banner tone="warn" icon={<Icon name="warning" size={16} />} title="A routing rule uses this agent">
            {`${props.rule.count} ${props.rule.count === 1 ? 'rule names' : 'rules name'} it: ${props.rule.command}. Point it at another agent first, then delete.`}
          </Banner>
        )}
        {props.state === 'blocked' && (
          <Banner tone="warn" icon={<Icon name="warning" size={16} />} title={props.reason.title}>
            {props.reason.text}
          </Banner>
        )}
        {props.state === 'error' && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive" title={props.error.title}>
            {props.error.requestId && <span>Request ID: {props.error.requestId}</span>}
          </Banner>
        )}
      </div>
    </Dialog>
  );
}
