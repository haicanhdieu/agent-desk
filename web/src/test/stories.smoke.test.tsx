import { composeStories } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('../**/*.stories.tsx', { eager: true }) as Record<
  string,
  Parameters<typeof composeStories>[0]
>;

describe('stories smoke', () => {
  it('finds at least one stories file', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  for (const [path, mod] of Object.entries(modules)) {
    describe(path, () => {
      const stories = composeStories(mod);
      for (const [name, composed] of Object.entries(stories)) {
        const Story = composed as ComponentType;
        it(`renders ${name}`, () => {
          const { container } = render(<Story />);
          expect(container).not.toBeEmptyDOMElement();
        });
      }
    });
  }
});
