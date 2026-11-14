import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Checkbox,
  Field,
  LabelInput,
  PasswordInput,
  PrefixInput,
  RadioCard,
  SearchInput,
  SegmentedControl,
  Select,
  StaticInput,
  TextInput,
  Toggle,
  UnitInput,
} from '.';

describe('Field', () => {
  it('associates the label with the control', () => {
    render(<Field label="Name">{({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} />}</Field>);
    expect(screen.getByLabelText('Name')).toBeInstanceOf(HTMLInputElement);
  });

  it('announces help and error via aria-describedby', () => {
    render(
      <Field label="Name" help="Helpful" error="Required">
        {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} />}
      </Field>,
    );
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Helpful Required');
  });

  it('has no describedby when there is no help or error', () => {
    render(<Field label="Name">{({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} />}</Field>);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
  });

  it('labelAs="span" renders a non-label flabel', () => {
    const { container } = render(
      <Field label="Posted on" labelAs="span">
        {() => <div />}
      </Field>,
    );
    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByText('Posted on')).toHaveClass('flabel');
  });
});

describe('inputs', () => {
  it('PasswordInput reveal flips type and aria-pressed', async () => {
    render(<PasswordInput aria-label="Token" revealLabel="Show token" />);
    const input = screen.getByLabelText('Token');
    const btn = screen.getByRole('button', { name: 'Show token' });
    expect(input).toHaveAttribute('type', 'password');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(input).toHaveAttribute('type', 'text');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('PrefixInput, UnitInput, SearchInput, StaticInput render', () => {
    render(
      <>
        <PrefixInput prefix="/" aria-label="cmd" />
        <UnitInput unit="minutes" aria-label="timeout" />
        <SearchInput placeholder="Search runs" aria-label="search" />
        <StaticInput icon="branch">main, default branch</StaticInput>
      </>,
    );
    expect(screen.getByLabelText('cmd')).toBeInTheDocument();
    expect(screen.getByText('minutes')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search runs')).toBeInTheDocument();
    expect(screen.getByText('main, default branch')).toBeInTheDocument();
  });

  it('Select passes disabled through', () => {
    render(
      <Select aria-label="Agent" disabled>
        <option>Claude</option>
      </Select>,
    );
    expect(screen.getByLabelText('Agent')).toBeDisabled();
  });
});

function Seg({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState('a');
  return (
    <SegmentedControl
      aria-label="Posted on"
      value={v}
      options={[
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma' },
      ]}
      onChange={(n) => {
        setV(n);
        onChange?.(n);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radiogroup with roving tabindex', () => {
    render(<Seg />);
    expect(screen.getByRole('radiogroup', { name: 'Posted on' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight moves selection and focus, wraps with ArrowLeft', async () => {
    const onChange = vi.fn();
    render(<Seg onChange={onChange} />);
    screen.getByRole('radio', { name: 'Alpha' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('c');
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('a');
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('c');
  });

  it('click selects', async () => {
    const onChange = vi.fn();
    render(<Seg onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('with an empty options list renders without throwing', () => {
    render(<SegmentedControl aria-label="x" value="" options={[]} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('value matching no option keeps the first option tabbable', () => {
    render(
      <SegmentedControl
        aria-label="x"
        value="zzz"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('tabindex', '0');
  });
});

describe('Toggle', () => {
  it('is a switch and Space toggles', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} aria-label="Enabled" />);
    const sw = screen.getByRole('switch', { name: 'Enabled' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    sw.focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked', () => {
    render(<Toggle checked onChange={() => {}} aria-label="Enabled" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Checkbox / RadioCard', () => {
  it('Checkbox click calls onChange(true)', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} aria-label="Agree" />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agree' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('RadioCard is selectable by clicking its title text', async () => {
    const onChange = vi.fn();
    render(
      <RadioCard
        type="radio"
        name="repo"
        checked={false}
        onChange={onChange}
        title="acme/web"
        description="Default"
        aside={<button>Preview</button>}
      />,
    );
    await userEvent.click(screen.getByText('acme/web'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('radio', { name: /acme\/web/ })).toBeInTheDocument();
  });

  it('RadioCard checkbox type renders a checkbox', () => {
    render(<RadioCard type="checkbox" name="s" checked onChange={() => {}} title="Skill" />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});

describe('LabelInput', () => {
  it('Enter adds the trimmed text and clears', async () => {
    const onAdd = vi.fn();
    render(<LabelInput labels={['a']} onAdd={onAdd} onRemove={() => {}} placeholder="Add label" />);
    await userEvent.type(screen.getByPlaceholderText('Add label'), '  bug {Enter}');
    expect(onAdd).toHaveBeenCalledWith('bug');
    expect(screen.getByPlaceholderText('Add label')).toHaveValue('');
  });

  it('Enter on blank input does nothing', async () => {
    const onAdd = vi.fn();
    render(<LabelInput labels={[]} onAdd={onAdd} onRemove={() => {}} placeholder="Add label" />);
    await userEvent.type(screen.getByPlaceholderText('Add label'), '   {Enter}');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('Backspace on empty removes last; not when typing; not with no labels', async () => {
    const onRemove = vi.fn();
    const { rerender } = render(
      <LabelInput labels={['a', 'b']} onAdd={() => {}} onRemove={onRemove} placeholder="Add label" />,
    );
    const input = screen.getByPlaceholderText('Add label');
    await userEvent.type(input, 'x{Backspace}');
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.keyboard('{Backspace}');
    expect(onRemove).toHaveBeenCalledWith('b');
    onRemove.mockClear();
    rerender(<LabelInput labels={[]} onAdd={() => {}} onRemove={onRemove} placeholder="Add label" />);
    await userEvent.type(screen.getByPlaceholderText('Add label'), '{Backspace}');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('chip remove button calls onRemove', async () => {
    const onRemove = vi.fn();
    render(<LabelInput labels={['bug']} onAdd={() => {}} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove label bug' }));
    expect(onRemove).toHaveBeenCalledWith('bug');
  });

  it('Enter during IME composition does not add', async () => {
    const onAdd = vi.fn();
    render(<LabelInput labels={[]} onAdd={onAdd} onRemove={() => {}} placeholder="Add label" />);
    const input = screen.getByPlaceholderText('Add label');
    await userEvent.type(input, 'x');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true } as KeyboardEventInit);
    input.dispatchEvent(ev);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('Button variant hover specificity', () => {
  it('variant selectors are compounded with .btn so they outrank .btn:hover', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/ds/Button.module.css', 'utf8');
    for (const v of ['primary', 'go', 'danger', 'solid-danger', 'ghost']) {
      expect(css).toMatch(new RegExp(`^\\.btn\\.${v} \\{`, 'm'));
      expect(css).not.toMatch(new RegExp(`^\\.${v} \\{`, 'm'));
    }
  });
});
