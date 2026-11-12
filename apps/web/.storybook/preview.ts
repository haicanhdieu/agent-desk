import type { Preview } from '@storybook/react-vite';
import '../src/ds/tokens.css';
import '../src/ds/global.css';
import { viewportOptions } from '../src/screens/viewports';

// Dark theme only: background, colour and color-scheme come from global.css.
// Layout stays Storybook's default (padded). Screens stories set `layout: 'fullscreen'` and a viewport global in
// their own meta (Storybook has no title-glob parameter); src/test/coverage.test.ts pins that.
const preview: Preview = {
  parameters: {
    backgrounds: { disabled: true },
    // Storybook has no title-glob parameter, so this applies to every story; it only gates when the a11y addon runs
    // under the Vitest integration. The enforced check is the axe run in src/test/stories.smoke.test.tsx.
    a11y: { test: 'error' },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    viewport: { options: viewportOptions },
    options: {
      storySort: { order: ['Introduction', 'Foundations', 'Primitives', 'Components', 'Screens'] },
    },
  },
};
export default preview;
