import { useState, type ReactNode } from 'react';
import type { AgentModelOption, AgentModelsDto, AgentModelsReason } from '@agentdesk/contracts';
import { Field, Icon, Select, TextInput } from '@/ds';
import styles from './ModelPicker.module.css';

export type ModelPickerState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'fallback'; reason: AgentModelsReason; host: string | null }
  | { kind: 'error' };

export interface ModelList {
  models: readonly AgentModelOption[];
  state: ModelPickerState;
}

export const OTHER_MODEL_LABEL = 'Other model…';
export const DEFAULT_MODEL_LABEL = 'Default model';

// Option values for the two fixed entries. A model id starts with a letter or digit, so these never collide.
const DEFAULT_VALUE = '_default';
const OTHER_VALUE = '_other';

function hostOf(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}

/** From a TanStack query's status/data and the agent's address (host only when set). */
export function toModelList(
  query: { status: 'pending' | 'error' | 'success'; data?: AgentModelsDto },
  baseUrl: string | null,
): ModelList {
  if (query.status === 'error') return { models: [], state: { kind: 'error' } };
  const data = query.data;
  if (query.status === 'pending' || !data) return { models: [], state: { kind: 'loading' } };
  if (data.source === 'live') return { models: data.models, state: { kind: 'ready' } };
  // Agent call: a built-in answer without a reason reads as "could not be loaded".
  return {
    models: data.models,
    state: { kind: 'fallback', reason: data.reason ?? 'unreachable', host: hostOf(baseUrl) },
  };
}

const STANDARD = 'Showing the standard names.';

/** Exact fallback copy per reason; `unreachable` with a host is the board line. */
export function fallbackNote(reason: AgentModelsReason, host: string | null): string {
  switch (reason) {
    case 'no_credential':
      return `${STANDARD} Save a credential to load the provider's list.`;
    case 'unreachable':
      return host
        ? `${STANDARD} The model list at ${host} could not be loaded.`
        : `${STANDARD} The model list could not be loaded.`;
    case 'rejected':
      return `${STANDARD} The provider did not accept the saved credential.`;
    case 'empty':
      return `${STANDARD} The provider returned no models.`;
    case 'disabled':
      return `${STANDARD} Live model lists are turned off on this server.`;
  }
}

/** The board sets the host in mono inside the note; the note text itself stays a plain string. */
function withHost(note: string, state: ModelPickerState): ReactNode {
  if (state.kind !== 'fallback' || !state.host) return note;
  const at = note.indexOf(state.host);
  if (at < 0) return note;
  return (
    <>
      {note.slice(0, at)}
      <span className="mono">{state.host}</span>
      {note.slice(at + state.host.length)}
    </>
  );
}

function stateNote(state: ModelPickerState): string | null {
  switch (state.kind) {
    case 'loading':
      return 'Loading models…';
    case 'error':
      return 'The model list could not be loaded. You can still type a model name.';
    case 'fallback':
      return fallbackNote(state.reason, state.host);
    case 'ready':
      return null;
  }
}

export interface ModelPickerProps {
  label: string;
  list: ModelList;
  /**
   * null = the leading Default model option (only with `withDefault`; without it null reads as nothing chosen).
   * `''` = Other model… picked and nothing typed yet. It is not a saveable model: a parent must block the save
   * or show a field error, because the API rejects an empty model name.
   */
  value: string | null;
  onChange(value: string | null): void;
  withDefault?: boolean;
  /** Under the select while a listed model or Default model is picked. */
  help?: ReactNode;
  /** Under the "Other model…" input. */
  typedHelp?: ReactNode;
  /** Field error; marks the active control invalid. */
  error?: string;
}

export function ModelPicker({ label, list, value, onChange, withDefault, help, typedHelp, error }: ModelPickerProps) {
  // Everything shown derives from `value` and the list; no local state, so a parent reset is always followed.
  const current = value ?? (withDefault ? null : '');
  // While the list loads, a saved model stays selected (as a provisional option) instead of flipping to Other.
  const provisional = list.state.kind === 'loading' && current ? [{ id: current, label: current }] : [];
  const models = provisional.length > 0 ? provisional : list.models;
  // The last text this picker emitted through Other model…: while the value still equals it, the person is typing
  // and the input stays, even when the text equals a listed id on the way. Any other value is an outside change.
  const [typed, setTyped] = useState<string | null>(null);
  if (typed !== null && value !== typed) setTyped(null);
  const typing = current !== null && current === typed;
  const other = current !== null && (typing || !models.some((m) => m.id === current));
  const selectValue = other ? OTHER_VALUE : current === null ? DEFAULT_VALUE : current;
  const note = stateNote(list.state);

  function pick(next: string) {
    setTyped(next === OTHER_VALUE ? '' : null);
    if (next === OTHER_VALUE) onChange('');
    else if (next === DEFAULT_VALUE) onChange(null);
    else onChange(next);
  }

  const below = (
    <>
      {note && (
        <span className={styles.note}>
          <span className={styles.noteIcon}>
            <Icon name="info" size={13} />
          </span>
          <span>{withHost(note, list.state)}</span>
        </span>
      )}
      {other ? typedHelp : help}
    </>
  );
  const hasBelow = note !== null || (other ? typedHelp : help) != null;

  return (
    <Field label={label} help={hasBelow ? below : undefined} error={error}>
      {({ id, describedBy, invalid }) => (
        <>
          <Select
            id={id}
            mono
            value={selectValue}
            onChange={(e) => pick(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={other ? undefined : invalid}
          >
            {withDefault && <option value={DEFAULT_VALUE}>{DEFAULT_MODEL_LABEL}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id} title={m.label}>
                {m.id}
              </option>
            ))}
            <option value={OTHER_VALUE}>{OTHER_MODEL_LABEL}</option>
          </Select>
          {other && (
            <TextInput
              mono
              aria-label="Model name"
              value={value ?? ''}
              onChange={(e) => {
                setTyped(e.target.value);
                onChange(e.target.value);
              }}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </>
      )}
    </Field>
  );
}
