import { useState, type FormEvent } from 'react';
import {
  Button, Field, Icon, InlineStatus, PasswordInput, SegmentedControl, StatusIcon,
} from '@/ds';
import styles from './SecretField.module.css';

export type SecretFieldState = 'empty' | 'entering' | 'saved' | 'replacing';
export type CredentialType = 'oauth_token' | 'api_key';

export interface SecretFieldProps {
  state: SecretFieldState;
  credentialType: CredentialType;
  onCredentialTypeChange?(t: CredentialType): void;
  savedInfo?: { setAt: string; setBy: string; status?: { tone: 'ok' | 'err'; text: string } };
  onReplace?(): void;
  onCancel?(): void;
  onSubmit?(value: string): void;
  submitLabel?: string;
  /** Help under the token input while entering (the replace panel has its own). */
  entryHelp?: string;
  /** Accessible name of the reveal button while entering. Defaults to "Show token". */
  revealLabel?: string;
  /** Omit the submit button when the surrounding flow supplies the action. Enter still submits. */
  hideSubmit?: boolean;
  /** Message from a failed save or test; shown under the token input. */
  error?: string;
}

const typeName: Record<CredentialType, string> = {
  oauth_token: 'Claude Code OAuth token',
  api_key: 'API key',
};

const typeOptions: { value: CredentialType; label: string }[] = [
  { value: 'oauth_token', label: typeName.oauth_token },
  { value: 'api_key', label: typeName.api_key },
];

/** Owns the typed secret; mounted only while entering so it always starts empty and is dropped on unmount. */
function SecretEntry({
  label, help, error, submitLabel, revealLabel, hideSubmit, onSubmit, onCancel,
}: {
  label: string; help?: string; error?: string; submitLabel: string; revealLabel?: string; hideSubmit?: boolean;
  onSubmit?(v: string): void; onCancel?(): void;
}) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value) onSubmit?.(value);
  };
  return (
    <form className={styles.entry} onSubmit={submit}>
      <Field label={label} help={help} error={error}>
        {({ id, describedBy, invalid }) => (
          <PasswordInput
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            revealLabel={revealLabel ?? `Show ${label.toLowerCase()}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </Field>
      {(!hideSubmit || onCancel) && (
        <div className={styles.actions}>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
          {!hideSubmit && <Button type="submit" variant="primary" disabled={!value}>{submitLabel}</Button>}
        </div>
      )}
    </form>
  );
}

export function SecretField({
  state, credentialType, onCredentialTypeChange, savedInfo, onReplace, onCancel, onSubmit, submitLabel,
  entryHelp, revealLabel, hideSubmit, error,
}: SecretFieldProps) {
  if (state === 'empty' || state === 'entering') {
    return (
      <SecretEntry
        label="Token" help={entryHelp} error={error} revealLabel={revealLabel} hideSubmit={hideSubmit}
        submitLabel={submitLabel ?? 'Save and test'} onSubmit={onSubmit}
      />
    );
  }

  const replacing = state === 'replacing';
  const status = savedInfo?.status;
  return (
    <div className={styles.wrap}>
      <div className={styles.saved}>
        <Icon name="key" size={18} />
        <div className={styles.info}>
          <b>{typeName[credentialType]}</b>
          <span>
            {savedInfo ? `Set ${savedInfo.setAt} by ${savedInfo.setBy}. ` : ''}Hidden for good after saving.
          </span>
        </div>
        {status && (
          <InlineStatus
            tone={status.tone}
            icon={<StatusIcon status={status.tone === 'ok' ? 'succeeded' : 'failed'} size={12} />}
          >
            {status.text}
          </InlineStatus>
        )}
        <Button size="sm" aria-expanded={replacing} onClick={onReplace}>Replace</Button>
      </div>
      {replacing && (
        <div className={styles.panel}>
          <b>Replace credential</b>
          <SegmentedControl
            aria-label="Credential type"
            value={credentialType}
            options={typeOptions}
            onChange={(t) => onCredentialTypeChange?.(t)}
          />
          <SecretEntry
            label="New token"
            error={error}
            help="We test the new token with one small call before saving. The old token is overwritten; runs already in progress keep the one they started with."
            submitLabel={submitLabel ?? 'Test and replace'}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        </div>
      )}
    </div>
  );
}
