import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import {
  DEFAULT_MODEL_LABEL,
  ModelPicker,
  OTHER_MODEL_LABEL,
  fallbackNote,
  toModelList,
  type ModelList,
  type ModelPickerProps,
} from './ModelPicker';

const live: ModelList = { models: agentModelsFixtures.live.models, state: { kind: 'ready' } };

/** Keeps `value` in state like a real parent, and reports every change to `onChange`. */
function Stateful({ initial, onChange, ...rest }: Omit<ModelPickerProps, 'value'> & { initial: string | null }) {
  const [v, setV] = useState<string | null>(initial);
  return (
    <ModelPicker
      {...rest}
      value={v}
      onChange={(next) => {
        onChange(next);
        setV(next);
      }}
    />
  );
}

function setup(over: Partial<ModelPickerProps> = {}) {
  const onChange = vi.fn();
  render(
    <ModelPicker label="Default model" list={live} value="claude-opus-4-5-20251101" onChange={onChange} {...over} />,
  );
  return { onChange, select: screen.getByRole('combobox', { name: 'Default model' }) };
}

const optionTexts = (select: HTMLElement) => Array.from(select.querySelectorAll('option')).map((o) => o.textContent);

describe('ModelPicker', () => {
  it('lists models in order with Other model… last', () => {
    const { select } = setup();
    expect(optionTexts(select)).toEqual([
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-1-20250805',
      OTHER_MODEL_LABEL,
    ]);
    expect(select.querySelector('option')).toHaveAttribute('title', 'Claude Opus 4.5');
    expect(select).toHaveValue('claude-opus-4-5-20251101');
  });

  it('withDefault puts Default model first and maps it to null', async () => {
    const { select, onChange } = setup({ withDefault: true, value: 'claude-opus-4-1-20250805' });
    expect(optionTexts(select)[0]).toBe(DEFAULT_MODEL_LABEL);
    await userEvent.selectOptions(select, DEFAULT_MODEL_LABEL);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('selects Default model when value is null', () => {
    const { select } = setup({ withDefault: true, value: null });
    expect(select).toHaveDisplayValue(DEFAULT_MODEL_LABEL);
    expect(screen.queryByRole('textbox', { name: 'Model name' })).toBeNull();
  });

  it('picking a listed model passes its id', async () => {
    const { select, onChange } = setup();
    await userEvent.selectOptions(select, 'claude-haiku-4-5-20251001');
    expect(onChange).toHaveBeenCalledWith('claude-haiku-4-5-20251001');
  });

  it('picking Other model… shows the Model name input and onChange gets ""', async () => {
    const onChange = vi.fn();
    render(<Stateful label="Default model" list={live} initial="claude-opus-4-5-20251101" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), OTHER_MODEL_LABEL);
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveValue('');
  });

  it('follows the value when the parent resets it after Other model… was picked (finding 1)', async () => {
    const props = { label: 'Model', list: live, withDefault: true, onChange: vi.fn() };
    const { rerender } = render(<ModelPicker {...props} value="claude-haiku-4-5-20251001" />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Model' }), OTHER_MODEL_LABEL);
    rerender(<ModelPicker {...props} value={null} />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveDisplayValue(DEFAULT_MODEL_LABEL);
    expect(screen.queryByRole('textbox', { name: 'Model name' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Model' }), OTHER_MODEL_LABEL);
    rerender(<ModelPicker {...props} value="claude-opus-4-1-20250805" />);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveDisplayValue('claude-opus-4-1-20250805');
    expect(screen.queryByRole('textbox', { name: 'Model name' })).toBeNull();
  });

  it('keeps the input mounted and focused while typed text passes through a listed id', async () => {
    const onChange = vi.fn();
    const list: ModelList = { models: agentModelsFixtures.noCredential.models, state: { kind: 'ready' } };
    render(<Stateful label="Default model" list={list} initial="opus" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), OTHER_MODEL_LABEL);
    const input = screen.getByRole('textbox', { name: 'Model name' });
    await userEvent.type(input, 'sonnet-4-5-custom');
    expect(screen.getByRole('textbox', { name: 'Model name' })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('sonnet-4-5-custom');
    expect(onChange).toHaveBeenLastCalledWith('sonnet-4-5-custom');
  });

  it('an outside reset to a listed id still collapses the input after typing', async () => {
    const props = { label: 'Model', list: live, withDefault: true, onChange: vi.fn() };
    function Harness({ reset }: { reset: boolean }) {
      const [v, setV] = useState<string | null>('claude-haiku-4-5-20251001');
      return <ModelPicker {...props} value={reset ? 'claude-opus-4-1-20250805' : v} onChange={setV} />;
    }
    const { rerender } = render(<Harness reset={false} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Model' }), OTHER_MODEL_LABEL);
    await userEvent.type(screen.getByRole('textbox', { name: 'Model name' }), 'abc');
    rerender(<Harness reset />);
    expect(screen.queryByRole('textbox', { name: 'Model name' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveDisplayValue('claude-opus-4-1-20250805');
  });

  it('without withDefault a null value reads as nothing chosen, not as the first model (finding 3)', () => {
    setup({ value: null });
    expect(screen.getByRole('combobox', { name: 'Default model' })).toHaveDisplayValue(OTHER_MODEL_LABEL);
    expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveValue('');
  });

  it('while loading a saved model stays selected instead of flipping to Other model… (finding 5)', () => {
    setup({ list: { models: [], state: { kind: 'loading' } }, value: 'claude-opus-4-5-20251101' });
    expect(screen.getByRole('combobox', { name: 'Default model' })).toHaveDisplayValue('claude-opus-4-5-20251101');
    expect(screen.queryByRole('textbox', { name: 'Model name' })).toBeNull();
  });

  it('picking a listed model hides the input', async () => {
    function Harness() {
      const [v, setV] = useState<string | null>('my/custom');
      return <ModelPicker label="Default model" list={live} value={v} onChange={setV} />;
    }
    render(<Harness />);
    expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveValue('my/custom');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), 'claude-haiku-4-5-20251001');
    expect(screen.queryByRole('textbox', { name: 'Model name' })).toBeNull();
  });

  it('typing in the input reports the typed value', async () => {
    const { onChange } = setup({ value: '' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Model name' }), 'x');
    expect(onChange).toHaveBeenLastCalledWith('x');
  });

  it('a value not in the list shows Other model… with the value in the input', () => {
    const { select } = setup({ value: 'sonnet' });
    expect(select).toHaveDisplayValue(OTHER_MODEL_LABEL);
    expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveValue('sonnet');
  });

  it('shows help under a listed model and typedHelp under the input', () => {
    const { unmount } = render(
      <ModelPicker
        label="Model"
        list={live}
        value="claude-opus-4-5-20251101"
        onChange={vi.fn()}
        help="Plain help"
        typedHelp="Typed help"
      />,
    );
    expect(screen.getByText('Plain help')).toBeInTheDocument();
    expect(screen.queryByText('Typed help')).toBeNull();
    unmount();
    render(
      <ModelPicker label="Model" list={live} value="zzz" onChange={vi.fn()} help="Plain help" typedHelp="Typed help" />,
    );
    expect(screen.getByText('Typed help')).toBeInTheDocument();
    expect(screen.queryByText('Plain help')).toBeNull();
  });

  it('fallback shows the reason note; unreachable with a host reads "Showing the standard names. The model list at gateway.harbor-labs.com could not be loaded."', () => {
    const models = agentModelsFixtures.unreachable.models;
    setup({
      list: { models, state: { kind: 'fallback', reason: 'unreachable', host: 'gateway.harbor-labs.com' } },
      value: 'opus',
    });
    const host = screen.getByText('gateway.harbor-labs.com');
    expect(host).toHaveClass('mono');
    expect(host.parentElement).toHaveTextContent(
      'Showing the standard names. The model list at gateway.harbor-labs.com could not be loaded.',
    );
  });

  it('a rejected fallback with a host names the host in mono and never a path or scheme', () => {
    const models = agentModelsFixtures.rejected.models;
    render(
      <ModelPicker
        label="Default model"
        list={{ models, state: { kind: 'fallback', reason: 'rejected', host: 'gateway.harbor-labs.com' } }}
        value="opus"
        onChange={vi.fn()}
      />,
    );
    const host = screen.getByText('gateway.harbor-labs.com');
    expect(host).toHaveClass('mono');
    expect(host.parentElement).toHaveTextContent(
      'Showing the standard names. The provider at gateway.harbor-labs.com did not accept the saved credential.',
    );
  });

  it('fallbackNote words every reason', () => {
    expect(fallbackNote('no_credential', null)).toBe(
      "Showing the standard names. Save a credential to load the provider's list.",
    );
    expect(fallbackNote('unreachable', null)).toBe('Showing the standard names. The model list could not be loaded.');
    expect(fallbackNote('rejected', null)).toBe(
      'Showing the standard names. The provider did not accept the saved credential.',
    );
    expect(fallbackNote('empty', null)).toBe('Showing the standard names. The provider returned no models.');
    expect(fallbackNote('disabled', null)).toBe(
      'Showing the standard names. Live model lists are turned off on this server.',
    );
    expect(fallbackNote('no_credential', 'h.example.com')).toBe(fallbackNote('no_credential', null));
    expect(fallbackNote('empty', 'h.example.com')).toBe(fallbackNote('empty', null));
    expect(fallbackNote('disabled', 'h.example.com')).toBe(fallbackNote('disabled', null));
    expect(fallbackNote('unreachable', 'h.example.com')).toBe(
      'Showing the standard names. The model list at h.example.com could not be loaded.',
    );
    expect(fallbackNote('rejected', 'h.example.com')).toBe(
      'Showing the standard names. The provider at h.example.com did not accept the saved credential.',
    );
  });

  it.each([
    ['loading', { kind: 'loading' } as const, 'Loading models…'],
    ['error', { kind: 'error' } as const, 'The model list could not be loaded. You can still type a model name.'],
  ])('%s still allows Other model… and typing', async (_n, state, copy) => {
    const onChange = vi.fn();
    render(
      <Stateful label="Default model" list={{ models: [], state }} withDefault initial={null} onChange={onChange} />,
    );
    const select = screen.getByRole('combobox', { name: 'Default model' });
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(optionTexts(select)).toEqual([DEFAULT_MODEL_LABEL, OTHER_MODEL_LABEL]);
    await userEvent.selectOptions(select, OTHER_MODEL_LABEL);
    expect(onChange).toHaveBeenCalledWith('');
    await userEvent.type(screen.getByRole('textbox', { name: 'Model name' }), 'x');
    expect(onChange).toHaveBeenLastCalledWith('x');
  });

  it('error marks the input invalid when Other model… is active, else the select', () => {
    const { unmount } = render(
      <ModelPicker label="Model" list={live} value="typed" onChange={vi.fn()} error="Bad name" />,
    );
    expect(screen.getByRole('textbox', { name: 'Model name' })).toBeInvalid();
    expect(screen.getByRole('combobox', { name: 'Model' })).not.toBeInvalid();
    expect(screen.getByText('Bad name')).toBeInTheDocument();
    unmount();
    render(
      <ModelPicker label="Model" list={live} value="claude-opus-4-5-20251101" onChange={vi.fn()} error="Bad name" />,
    );
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInvalid();
  });
});

describe('toModelList', () => {
  it('pending is loading, error is error', () => {
    expect(toModelList({ status: 'pending' }, null)).toEqual({ models: [], state: { kind: 'loading' } });
    expect(toModelList({ status: 'error' }, null)).toEqual({ models: [], state: { kind: 'error' } });
  });

  it('a live answer is ready', () => {
    const list = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
    expect(list.state).toEqual({ kind: 'ready' });
    expect(list.models).toHaveLength(4);
  });

  it('a builtin answer is a fallback with the host of the address', () => {
    const list = toModelList(
      { status: 'success', data: agentModelsFixtures.unreachable },
      'https://gateway.harbor-labs.com/v1/anthropic',
    );
    expect(list.state).toEqual({ kind: 'fallback', reason: 'unreachable', host: 'gateway.harbor-labs.com' });
  });

  it('a builtin answer without an address has no host', () => {
    const list = toModelList({ status: 'success', data: agentModelsFixtures.noCredential }, null);
    expect(list.state).toEqual({ kind: 'fallback', reason: 'no_credential', host: null });
  });

  it('defaultLabel renames the leading default option', () => {
    render(
      <ModelPicker
        label="Default model"
        list={live}
        value={null}
        onChange={() => {}}
        withDefault
        defaultLabel="OpenCode default"
      />,
    );
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('OpenCode default');
    expect(screen.queryByRole('option', { name: DEFAULT_MODEL_LABEL })).toBeNull();
  });
});
