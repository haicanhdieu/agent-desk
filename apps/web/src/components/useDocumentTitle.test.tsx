import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDocumentTitle } from './useDocumentTitle';

function Probe({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}

describe('useDocumentTitle', () => {
  it('sets the title, updates it on rerender and restores the previous one on unmount', () => {
    document.title = 'Before';
    const { rerender, unmount } = render(<Probe title="One" />);
    expect(document.title).toBe('One');
    rerender(<Probe title="Two" />);
    expect(document.title).toBe('Two');
    unmount();
    expect(document.title).toBe('Before');
  });
});
