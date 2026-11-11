import type { Preview } from '@storybook/react-vite';
import '../src/ds/tokens.css';
import '../src/ds/global.css';

// Dark theme only: background, colour and color-scheme come from global.css.
const preview: Preview = {
  parameters: {
    backgrounds: { disabled: true },
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};
export default preview;
