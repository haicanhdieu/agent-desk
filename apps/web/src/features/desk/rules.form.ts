import {
  CreateRuleRequest,
  type CreatePromptRuleRequest,
  type CreateSkillRuleRequest,
  type RuleDto,
  type RuleKind,
  type UpdateRuleRequest,
} from '@agentdesk/contracts';
import { revalidateLogic, useField, useForm, useStore, type ValidationErrorMap } from '@tanstack/react-form';
import { useState } from 'react';
import { fieldErrorsFromProblem } from './problem';
import { useSaveRule } from './mutations';

// The rule form (spec §4.3): TanStack Form validated with the contract's CreateRuleRequest (Standard Schema), first on
// submit and then on every change. Server problems land on the field their JSON Pointer names, else in a form banner.

/**
 * The form's own view of the two contract branches: both kinds' fields live side by side, so switching kind keeps what
 * was typed. `toCreateRequest` narrows it to one branch.
 */
export type RuleValues = Omit<CreateSkillRuleRequest, 'kind' | 'skillName'> &
  Pick<CreateSkillRuleRequest, 'skillName'> &
  Pick<CreatePromptRuleRequest, 'prompt'> & { kind: RuleKind };
type ValueField = Exclude<keyof RuleValues, 'enabled' | 'kind'>;

/** The create request for the current kind; the other kind's field is dropped. */
export function toCreateRequest(v: RuleValues): CreateRuleRequest {
  const common = { command: v.command, labelFilter: v.labelFilter, target: v.target, enabled: v.enabled };
  return v.kind === 'prompt'
    ? { ...common, kind: 'prompt', prompt: v.prompt }
    : { ...common, kind: 'skill', skillName: v.skillName };
}

/** RuleForm's field names (the screen's vocabulary) for each request field. */
const SCREEN_FIELD = {
  command: 'command',
  labelFilter: 'labels',
  target: 'target',
  skillName: 'skill',
  prompt: 'prompt',
} as const satisfies Record<ValueField, string>;

type ScreenField = (typeof SCREEN_FIELD)[ValueField];
export type RuleFieldErrors = Partial<Record<ScreenField, string>>;

/** problem+json pointers into the rule request body. */
export const RULE_POINTERS: Record<string, ValueField> = {
  '/command': 'command',
  '/labelFilter': 'labelFilter',
  '/target': 'target',
  '/skillName': 'skillName',
  '/prompt': 'prompt',
};

/** Shown for a schema issue instead of Zod's wording (server messages are shown as sent). */
const SCHEMA_MESSAGE: Record<ValueField, string> = {
  command: 'Use lowercase letters, numbers and dashes, like code-build.',
  labelFilter: 'Check the labels.',
  target: 'Pick where the comment is posted.',
  skillName: 'Pick a skill.',
  prompt: 'Write what the agent should do, up to 4,000 characters.',
};

const VALUE_FIELDS = Object.keys(SCREEN_FIELD) as ValueField[];

/** The first message in a field's error map: a server string as is, a schema issue as the friendly message. */
function messageOf(errorMap: ValidationErrorMap, field: ValueField): string | undefined {
  if (typeof errorMap.onServer === 'string') return errorMap.onServer;
  const schemaError = Object.values(errorMap).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0));
  return schemaError ? SCHEMA_MESSAGE[field] : undefined;
}

const isValueField = (name: unknown): name is ValueField => typeof name === 'string' && name in SCREEN_FIELD;

/**
 * Validates the current kind's request with the contract schema (the form holds both kinds' fields, so the schema can't
 * be the form's own validator). Returns the first issue per field, keyed by the form field it names.
 */
function validate(value: RuleValues) {
  const result = CreateRuleRequest.safeParse(toCreateRequest(value));
  if (result.success) return undefined;
  const fields: Partial<Record<ValueField, string>> = {};
  for (const issue of result.error.issues) {
    const name = issue.path[0];
    if (isValueField(name) && !(name in fields)) fields[name] = issue.message;
  }
  return { fields };
}

/** The fields of `value` that differ from `base` (labels compared by content), for a PATCH. */
export function changedFields(base: RuleValues, value: RuleValues): UpdateRuleRequest {
  const body: UpdateRuleRequest = {};
  // A switch sends kind plus the new kind's field; otherwise only the current kind's field, and only when changed.
  const switched = value.kind !== base.kind;
  if (switched) body.kind = value.kind;
  if (value.kind === 'skill') {
    if (switched || value.skillName !== base.skillName) body.skillName = value.skillName;
  } else if (switched || value.prompt !== base.prompt) body.prompt = value.prompt;
  if (value.command !== base.command) body.command = value.command;
  if (JSON.stringify(value.labelFilter) !== JSON.stringify(base.labelFilter)) body.labelFilter = value.labelFilter;
  if (value.target !== base.target) body.target = value.target;
  if (value.enabled !== base.enabled) body.enabled = value.enabled;
  return body;
}

export interface RuleFormOptions {
  /** The rule being edited; none creates a rule. */
  initial?: RuleDto;
  /** The skill a new rule starts with. */
  defaultSkill?: string;
  /** Called after the rule saved. */
  onSaved?(rule: RuleDto): void;
}

export function useRuleForm(org: string, projectId: string, { initial, defaultSkill = '', onSaved }: RuleFormOptions) {
  const save = useSaveRule(org, projectId);
  // The form-level server message (a Banner); field messages live in each field's `onServer` error.
  const [formError, setFormError] = useState<string>();
  const defaultValues: RuleValues = {
    kind: initial?.kind ?? 'skill',
    command: initial?.command ?? '',
    labelFilter: initial?.labelFilter ?? [],
    target: initial?.target ?? 'issue',
    skillName: initial?.skillName ?? defaultSkill,
    prompt: initial?.prompt ?? '',
    enabled: initial?.enabled ?? true,
  };
  // What the draft started from: an edit sends only what differs, so a row toggle made meanwhile is not reverted.
  const [base] = useState(defaultValues);
  const form = useForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => validate(value) },
    onSubmit: async ({ value, formApi }) => {
      try {
        const rule = await save.mutateAsync(
          initial ? { id: initial.id, body: changedFields(base, value) } : { body: toCreateRequest(value) },
        );
        onSaved?.(rule);
      } catch (e) {
        // The values stay as typed; only the messages change.
        const { fields, form: formMessage } = fieldErrorsFromProblem(e, RULE_POINTERS);
        for (const name of VALUE_FIELDS) {
          const message = fields[name];
          if (message !== undefined)
            formApi.setFieldMeta(name, (prev) => ({
              ...prev,
              errorMap: { ...prev.errorMap, onServer: message },
            }));
        }
        setFormError(formMessage);
      }
    },
  });

  // Each request field is registered so form-level schema errors and server messages reach it.
  const fields = {
    command: useField({ form, name: 'command' }),
    labelFilter: useField({ form, name: 'labelFilter' }),
    target: useField({ form, name: 'target' }),
    skillName: useField({ form, name: 'skillName' }),
    prompt: useField({ form, name: 'prompt' }),
    kind: useField({ form, name: 'kind' }),
    enabled: useField({ form, name: 'enabled' }),
  };
  const submitting = useStore(form.store, (s) => s.isSubmitting);

  const clearServerError = (name: ValueField) => {
    if (fields[name].state.meta.errorMap.onServer !== undefined) fields[name].setErrorMap({ onServer: undefined });
  };

  // One typed setter per field (handleChange is typed per field name).
  const setField = <K extends keyof RuleValues>(name: K, value: RuleValues[K]) => {
    const setters: { [F in keyof RuleValues]: (v: RuleValues[F]) => void } = {
      command: (v) => fields.command.handleChange(v),
      labelFilter: (v) => fields.labelFilter.handleChange(v),
      target: (v) => fields.target.handleChange(v),
      skillName: (v) => fields.skillName.handleChange(v),
      prompt: (v) => fields.prompt.handleChange(v),
      kind: (v) => fields.kind.handleChange(v),
      enabled: (v) => fields.enabled.handleChange(v),
    };
    setters[name](value);
  };

  const errors: RuleFieldErrors = {};
  for (const name of VALUE_FIELDS) {
    const message = messageOf(fields[name].state.meta.errorMap, name);
    if (message !== undefined) errors[SCREEN_FIELD[name]] = message;
  }

  return {
    values: {
      command: fields.command.state.value,
      labelFilter: fields.labelFilter.state.value,
      target: fields.target.state.value,
      skillName: fields.skillName.state.value,
      prompt: fields.prompt.state.value,
      kind: fields.kind.state.value,
      enabled: fields.enabled.state.value,
    } satisfies RuleValues,
    /** Sets the changed fields; a changed field drops its server message, and any change drops the form banner. */
    change(next: RuleValues) {
      const patch: Partial<RuleValues> = { ...next, command: next.command.replace(/^\/+/, '') };
      let changed = false;
      for (const name of [...VALUE_FIELDS, 'kind', 'enabled'] as const) {
        const value = patch[name];
        if (value === undefined || value === fields[name].state.value) continue;
        changed = true;
        if (name !== 'enabled' && name !== 'kind') clearServerError(name);
        setField(name, value);
      }
      if (changed) setFormError(undefined);
    },
    errors,
    formError,
    submitting,
    submit() {
      if (form.state.isSubmitting) return;
      for (const name of VALUE_FIELDS) clearServerError(name);
      setFormError(undefined);
      void form.handleSubmit();
    },
  };
}
