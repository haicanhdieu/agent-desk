import type { Preview } from '@storybook/react-vite';
import '../src/ds/tokens.css';
import '../src/ds/global.css';
import { viewportOptions } from '../src/screens/viewports';

// Dark theme only: background, colour and color-scheme come from global.css.
// Screens stories set `layout: 'fullscreen'` and a viewport global in their own meta (Storybook has no title-glob parameter).
const preview: Preview = {
  parameters: {
    backgrounds: { disabled: true },
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    viewport: { options: viewportOptions },
    options: {
      storySort: { order: ['Introduction', 'Foundations', 'Primitives', 'Components', 'Screens'] },
    },
  },
};
export default preview;
