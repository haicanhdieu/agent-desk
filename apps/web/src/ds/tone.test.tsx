import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineStatus } from './InlineStatus';

describe('StatusTone vocabulary', () => {
  it('InlineStatus accepts err and off', () => {
    const { container: a } = render(<InlineStatus tone="err">x</InlineStatus>);
    expect(a.firstElementChild).toHaveClass('err');
    const { container: b } = render(<InlineStatus tone="off">x</InlineStatus>);
    expect(b.firstElementChild).toHaveClass('off');
  });

  it('rejects the legacy fail tone at the type level', () => {
    // @ts-expect-error 'fail' was renamed to 'err'
    render(<InlineStatus tone="fail">x</InlineStatus>);
  });
});
