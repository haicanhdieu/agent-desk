import { composeStories } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import { render } from '@testing-library/react';
import axe from 'axe-core';
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
        if (/^(Primitives|Components|Screens)\//.test(String(mod.default.title))) {
          it(`has no axe violations in ${name}`, async () => {
            const { container } = render(<Story />);
            // jsdom cannot compute colours, so contrast is checked in the built Storybook instead.
            const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
            expect(
              result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
            ).toEqual([]);
          });
        }
      }
    });
  }
});
