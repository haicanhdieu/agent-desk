import { CreateRuleRequest, type RuleDto } from '@agentdesk/contracts';
import { revalidateLogic, useField, useForm, useStore, type ValidationErrorMap } from '@tanstack/react-form';
import { useState } from 'react';
import { fieldErrorsFromProblem } from './problem';
import { useSaveRule } from './mutations';

// The rule form (spec §4.3): TanStack Form validated with the contract's CreateRuleRequest (Standard Schema), first on
// submit and then on every change. Server problems land on the field their JSON Pointer names, else in a form banner.

type RuleValues = CreateRuleRequest;
type ValueField = keyof Omit<RuleValues, 'enabled'>;

/** RuleForm's field names (the screen's vocabulary) for each request field. */
const SCREEN_FIELD = {
  command: 'command',
  labelFilter: 'labels',
  target: 'target',
  skillName: 'skill',
} as const satisfies Record<ValueField, string>;

type ScreenField = (typeof SCREEN_FIELD)[ValueField];
export type RuleFieldErrors = Partial<Record<ScreenField, string>>;

/** problem+json pointers into the rule request body. */
export const RULE_POINTERS: Record<string, ValueField> = {
  '/command': 'command',
  '/labelFilter': 'labelFilter',
  '/target': 'target',
  '/skillName': 'skillName',
};

/** Shown for a schema issue instead of Zod's wording (server messages are shown as sent). */
const SCHEMA_MESSAGE: Record<ValueField, string> = {
  command: 'Use lowercase letters, numbers and dashes, like code-build.',
  labelFilter: 'Check the labels.',
  target: 'Pick where the comment is posted.',
  skillName: 'Pick a skill.',
};

const VALUE_FIELDS = Object.keys(SCREEN_FIELD) as ValueField[];

/** The first message in a field's error map: a server string as is, a schema issue as the friendly message. */
function messageOf(errorMap: ValidationErrorMap, field: ValueField): string | undefined {
  if (typeof errorMap.onServer === 'string') return errorMap.onServer;
  const schemaError = Object.values(errorMap).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0));
  return schemaError ? SCHEMA_MESSAGE[field] : undefined;
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
    command: initial?.command ?? '',
    labelFilter: initial?.labelFilter ?? [],
    target: initial?.target ?? 'issue',
    skillName: initial?.skillName ?? defaultSkill,
    enabled: initial?.enabled ?? true,
  };
  const form = useForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: CreateRuleRequest },
    onSubmit: async ({ value, formApi }) => {
      try {
        const rule = await save.mutateAsync(initial ? { id: initial.id, body: value } : { body: value });
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
    enabled: useField({ form, name: 'enabled' }),
  };
  const submitting = useStore(form.store, (s) => s.isSubmitting);

  const clearServerError = (name: ValueField) => {
    if (fields[name].state.meta.errorMap.onServer !== undefined) fields[name].setErrorMap({ onServer: undefined });
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
      enabled: fields.enabled.state.value,
    } satisfies RuleValues,
    /** Sets the changed fields; a changed field drops its server message. */
    change(next: RuleValues) {
      const command = next.command.replace(/^\/+/, '');
      if (command !== fields.command.state.value) {
        clearServerError('command');
        fields.command.handleChange(command);
      }
      if (next.labelFilter !== fields.labelFilter.state.value) {
        clearServerError('labelFilter');
        fields.labelFilter.handleChange(next.labelFilter);
      }
      if (next.target !== fields.target.state.value) {
        clearServerError('target');
        fields.target.handleChange(next.target);
      }
      if (next.skillName !== fields.skillName.state.value) {
        clearServerError('skillName');
        fields.skillName.handleChange(next.skillName);
      }
      if (next.enabled !== fields.enabled.state.value) fields.enabled.handleChange(next.enabled);
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
