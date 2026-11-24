import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CreateEnvSecretRequest,
  CreateEnvVarRequest,
  UpdateEnvSecretRequest,
  UpdateEnvVarRequest,
} from '@agentdesk/contracts';
import { Banner, Button, Dialog, Field, Icon, PasswordInput, Skeleton, TextInput } from '@/ds';
import { Pagination, type PaginationProps } from './Pagination';
import styles from './EnvEntryList.module.css';

export interface EnvEntryRow {
  name: string;
  /** Plain rows only. A secret row never carries a value. */
  value?: string;
  /** Secret rows only, e.g. "Set 2 days ago by kim-hale". */
  meta?: string;
}

export interface EnvSaveError {
  field?: { name?: string; value?: string };
  banner?: { title: string; detail?: string; requestId?: string };
  /** The entry was removed meanwhile. */
  gone?: boolean;
}

export type EnvSaveResult = Promise<EnvSaveError | null>;

export interface EnvEntryListProps {
  kind: 'variable' | 'secret';
  entries: EnvEntryRow[];
  total?: number;
  loading?: boolean;
  loadError?: { message: string; requestId?: string };
  onRetry?(): void;
  canWrite: boolean;
  pagination?: PaginationProps;
  onCreate?(input: { name: string; value: string }): EnvSaveResult;
  onUpdate?(name: string, value: string): EnvSaveResult;
  onRemove?(name: string): EnvSaveResult;
  /** Seeds story states only. */
  initial?: { adding?: boolean; editing?: string; saving?: boolean; removing?: string };
}

const GONE = 'This entry no longer exists. Reload the list.';

const copy = {
  variable: {
    label: 'Environment variables',
    noun: 'variable',
    nouns: 'variables',
    add: 'Add variable',
    remove: 'Remove variable',
    empty: 'No environment variables yet. Add one to pass a setting to every run.',
    loading: 'Loading variables',
  },
  secret: {
    label: 'Secrets',
    noun: 'secret',
    nouns: 'secrets',
    add: 'Add secret',
    remove: 'Remove secret',
    empty: 'No secrets yet. Add one for the tokens and passwords your setup or agent needs.',
    loading: 'Loading secrets',
  },
} as const;

type FieldErrors = { name?: string; value?: string };

function validate(
  kind: EnvEntryListProps['kind'],
  mode: 'add' | 'edit',
  name: string,
  value: string,
): FieldErrors | null {
  const schema =
    mode === 'add'
      ? kind === 'secret'
        ? CreateEnvSecretRequest
        : CreateEnvVarRequest
      : kind === 'secret'
        ? UpdateEnvSecretRequest
        : UpdateEnvVarRequest;
  const result = schema.safeParse(mode === 'add' ? { name, value } : { value });
  if (result.success) return null;
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (key === 'name' || key === 'value') errors[key] ??= issue.message;
  }
  return errors;
}

function RequestId({ id }: { id: string }) {
  return <span className={styles.reqId}>Request ID {id}</span>;
}

/** Mounted only while open, so a typed secret starts empty on every open and is dropped on unmount. */
function EntryForm({
  kind,
  mode,
  entryName,
  initialValue,
  initialSaving,
  onSubmit,
  onCancel,
}: {
  kind: EnvEntryListProps['kind'];
  mode: 'add' | 'edit';
  entryName?: string;
  initialValue: string;
  initialSaving?: boolean;
  onSubmit(name: string, value: string): EnvSaveResult;
  onCancel(): void;
}) {
  const c = copy[kind];
  const [name, setName] = useState('');
  const [value, setValue] = useState(initialValue);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<EnvSaveError['banner']>();
  const [gone, setGone] = useState(false);
  const [pending, setPending] = useState(initialSaving ?? false);
  const inflight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const secret = kind === 'secret';
  const replace = secret && mode === 'edit';
  const blockedBlank = replace && value === '';

  useEffect(() => {
    formRef.current?.querySelector('input')?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inflight.current || blockedBlank) return;
    const invalid = validate(kind, mode, name, value);
    setBanner(undefined);
    setGone(false);
    if (invalid) {
      setErrors(invalid);
      return;
    }
    setErrors({});
    inflight.current = true;
    setPending(true);
    let result: EnvSaveError | null;
    try {
      result = await onSubmit(name, value);
    } catch {
      result = { banner: { title: 'Something went wrong. Try again.' } };
    }
    if (result === null) return;
    inflight.current = false;
    setPending(false);
    setErrors(result.field ?? {});
    setBanner(result.banner);
    setGone(result.gone === true);
  };

  const groupLabel = mode === 'add' ? c.add : secret ? `Replace ${entryName}` : `Edit ${entryName}`;
  const valueLabel = replace ? 'New value' : 'Value';
  const valueField = (
    <Field label={valueLabel} help={secret ? 'At least 6 characters.' : undefined} error={errors.value}>
      {({ id, describedBy, invalid }) =>
        secret ? (
          <PasswordInput
            id={id}
            className={styles.mono}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            revealLabel="Show value"
            hideLabel="Hide value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <TextInput
            id={id}
            mono
            aria-describedby={describedBy}
            aria-invalid={invalid}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )
      }
    </Field>
  );

  return (
    <div className={styles.form} role="group" aria-label={groupLabel} aria-busy={pending || undefined}>
      <form
        ref={formRef}
        className={styles.formInner}
        noValidate
        onSubmit={(e) => void submit(e)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || pending) return;
          e.preventDefault();
          onCancel();
        }}
      >
        {banner && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} title={banner.title} live="assertive">
            {banner.detail}
            {banner.requestId && <RequestId id={banner.requestId} />}
          </Banner>
        )}
        {gone && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive">
            {GONE}
          </Banner>
        )}
        <div className={styles.fields}>
          {mode === 'add' ? (
            <Field label="Name" error={errors.name}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  mono
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  autoComplete="off"
                  spellCheck={false}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
          ) : (
            <div className={styles.fixedName}>
              <span className={styles.fixedLabel}>Name</span>
              <span className={`${styles.name} mono`} title={entryName}>
                {entryName}
              </span>
            </div>
          )}
          {valueField}
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending || blockedBlank}>
            {pending ? 'Saving…' : mode === 'add' ? c.add : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}

type Mode = { type: 'none' } | { type: 'add' } | { type: 'edit'; name: string };
type FocusTarget = { type: 'add' } | { type: 'row'; name: string };

export function EnvEntryList({
  kind,
  entries,
  total,
  loading,
  loadError,
  onRetry,
  canWrite,
  pagination,
  onCreate,
  onUpdate,
  onRemove,
  initial,
}: EnvEntryListProps) {
  const c = copy[kind];
  const [mode, setMode] = useState<Mode>(
    initial?.adding ? { type: 'add' } : initial?.editing ? { type: 'edit', name: initial.editing } : { type: 'none' },
  );
  const [removing, setRemoving] = useState<string | undefined>(initial?.removing);
  const [removePending, setRemovePending] = useState(initial?.removing !== undefined && initial.saving === true);
  // The entry whose save answered "gone": its form stays open after the refreshed list drops the row.
  const [goneName, setGoneName] = useState<string | undefined>();
  const [removeError, setRemoveError] = useState<EnvSaveError | null>(null);
  // A new object per request, so asking for the same target twice still runs the effect.
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const removeInflight = useRef(false);

  useEffect(() => {
    if (!focus) return;
    const root = rootRef.current;
    const target =
      focus.type === 'add'
        ? root?.querySelector<HTMLElement>('[data-env-add]')
        : [...(root?.querySelectorAll<HTMLElement>('[data-env-row-action]') ?? [])].find(
            (el) => el.dataset.envRowAction === focus.name,
          );
    // The entry may be gone (removed, or on another page now): the Add button is the fallback.
    (target ?? root?.querySelector<HTMLElement>('[data-env-add]'))?.focus();
  }, [focus]);

  const failed = loadError !== undefined;
  const showRows = !loading && !failed;
  const count = total ?? entries.length;
  const keepGone = mode.type === 'edit' && mode.name === goneName && !entries.some((e) => e.name === goneName);
  const rows: EnvEntryRow[] = keepGone && goneName !== undefined ? [...entries, { name: goneName }] : entries;
  const showPagination = pagination !== undefined && showRows && entries.length > 0;
  const adding = mode.type === 'add';

  const closeForm = (to: FocusTarget) => {
    setMode({ type: 'none' });
    setGoneName(undefined);
    setFocus({ ...to });
  };

  const confirmRemove = async () => {
    if (removing === undefined || removeInflight.current) return;
    removeInflight.current = true;
    setRemovePending(true);
    let result: EnvSaveError | null;
    try {
      result = (await onRemove?.(removing)) ?? null;
    } catch {
      result = { banner: { title: 'Something went wrong. Try again.' } };
    }
    removeInflight.current = false;
    setRemovePending(false);
    if (result === null) {
      setRemoving(undefined);
      setRemoveError(null);
      setFocus({ type: 'add' });
    } else {
      setRemoveError(result);
    }
  };

  const closeRemove = () => {
    if (removePending) return;
    setRemoving(undefined);
    setRemoveError(null);
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.header}>
        {showRows && count > 0 && (
          <span className={styles.count}>
            {count} {count === 1 ? c.noun : c.nouns}
          </span>
        )}
        <span className={styles.grow} />
        {canWrite && showRows && (
          <Button
            size="sm"
            icon="plus"
            data-env-add=""
            aria-expanded={adding}
            onClick={() => {
              setGoneName(undefined);
              setMode({ type: 'add' });
            }}
          >
            {c.add}
          </Button>
        )}
      </div>

      {loading && (
        <div role="status" aria-busy="true" className={styles.loading}>
          <span className="sr-only">{c.loading}</span>
          <Skeleton variant="text" lines={3} />
        </div>
      )}

      {failed && (
        <Banner
          tone="err"
          icon={<Icon name="warning" size={16} />}
          live="assertive"
          actions={
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {loadError.message}
          {loadError.requestId && <RequestId id={loadError.requestId} />}
        </Banner>
      )}

      {showRows && rows.length === 0 && !adding && <p className={styles.empty}>{c.empty}</p>}

      {showRows && rows.length > 0 && (
        <ul className={styles.list} aria-label={c.label}>
          {rows.map((entry) => {
            const editing = mode.type === 'edit' && mode.name === entry.name;
            return (
              <li key={entry.name} className={styles.row}>
                {editing ? (
                  <EntryForm
                    kind={kind}
                    mode="edit"
                    entryName={entry.name}
                    initialValue={kind === 'variable' ? (entry.value ?? '') : ''}
                    initialSaving={initial?.saving}
                    onSubmit={async (_n, value) => {
                      const result = (await onUpdate?.(entry.name, value)) ?? null;
                      if (result?.gone) setGoneName(entry.name);
                      if (result === null) closeForm({ type: 'row', name: entry.name });
                      return result;
                    }}
                    onCancel={() => closeForm({ type: 'row', name: entry.name })}
                  />
                ) : (
                  <>
                    <span className={`${styles.name} mono`} title={entry.name}>
                      {entry.name}
                    </span>
                    {kind === 'variable' ? (
                      entry.value ? (
                        <span className={`${styles.value} mono`} title={entry.value}>
                          {entry.value}
                        </span>
                      ) : (
                        <span className={styles.faint}>Empty</span>
                      )
                    ) : (
                      <span className={styles.secretInfo}>
                        <Icon name="key" size={14} />
                        <span aria-hidden="true" className={styles.mask}>
                          ••••••••
                        </span>
                        <span className="sr-only">Value hidden</span>
                        {entry.meta && <span className={styles.faint}>{entry.meta}</span>}
                      </span>
                    )}
                    {canWrite && (
                      <span className={styles.rowActions}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-env-row-action={entry.name}
                          aria-label={`${kind === 'secret' ? 'Replace' : 'Edit'} ${entry.name}`}
                          onClick={() => {
                            setGoneName(undefined);
                            setMode({ type: 'edit', name: entry.name });
                          }}
                        >
                          {kind === 'secret' ? 'Replace' : 'Edit'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${entry.name}`}
                          onClick={() => setRemoving(entry.name)}
                        >
                          Remove
                        </Button>
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && adding && (
        <EntryForm
          kind={kind}
          mode="add"
          initialValue=""
          initialSaving={initial?.saving}
          onSubmit={async (name, value) => {
            const result = (await onCreate?.({ name, value })) ?? null;
            if (result === null) closeForm({ type: 'add' });
            return result;
          }}
          onCancel={() => closeForm({ type: 'add' })}
        />
      )}

      {showPagination && <Pagination {...pagination} />}

      <Dialog
        open={removing !== undefined}
        title={`Remove ${removing ?? ''}?`}
        onClose={closeRemove}
        footer={
          <>
            <Button variant="ghost" onClick={closeRemove} disabled={removePending}>
              Keep
            </Button>
            <Button variant="solid-danger" icon="trash" disabled={removePending} onClick={() => void confirmRemove()}>
              {c.remove}
            </Button>
          </>
        }
      >
        <p className={styles.confirmText}>Runs that start after this do not get it. Running runs keep it.</p>
        {removeError && (
          <Banner
            tone="err"
            icon={<Icon name="warning" size={16} />}
            title={removeError.banner?.title}
            live="assertive"
          >
            {removeError.gone ? GONE : removeError.banner?.detail}
            {removeError.banner?.requestId && <RequestId id={removeError.banner.requestId} />}
          </Banner>
        )}
      </Dialog>
    </div>
  );
}
