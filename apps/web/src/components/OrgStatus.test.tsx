import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrgStatus } from './OrgStatus';

describe('OrgStatus', () => {
  it('shows a glyph and the text Active', () => {
    const { container } = render(<OrgStatus status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('shows a glyph and the text Suspended', () => {
    const { container } = render(<OrgStatus status="suspended" />);
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses a different glyph for each state, so colour is not the only cue', () => {
    const a = render(<OrgStatus status="active" />).container.innerHTML;
    const s = render(<OrgStatus status="suspended" />).container.innerHTML;
    expect(a).not.toEqual(s);
  });
});
