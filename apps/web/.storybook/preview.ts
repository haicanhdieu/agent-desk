import type { Decorator, Loader, Preview } from '@storybook/react-vite';
import { createElement } from 'react';
import '../src/ds/tokens.css';
import '../src/ds/global.css';
import { LinkProvider } from '../src/ds';
import { viewportOptions } from '../src/screens/viewports';
import { StoryLink } from './StoryLink';

// Stories render fixtures, not the router; MSW answers any API call a story makes from the same in-memory store
// as `dev:mock` (reset before each story). The worker file is served from ../public (main.ts staticDirs).
const mswLoader: Loader = async () => {
  const [{ startMockWorker }, { mockDb }] = await Promise.all([
    import('../src/mocks/msw/browser'),
    import('../src/mocks/msw/db'),
  ]);
  await startMockWorker({ quiet: true });
  mockDb.reset();
  return {};
};

const withLinks: Decorator = (Story) => createElement(LinkProvider, { component: StoryLink }, createElement(Story));

// Dark theme only: background, colour and color-scheme come from global.css.
// Layout stays Storybook's default (padded). Screens stories set `layout: 'fullscreen'` and a viewport global in
// their own meta (Storybook has no title-glob parameter); src/test/coverage.test.ts pins that.
const preview: Preview = {
  loaders: [mswLoader],
  decorators: [withLinks],
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
