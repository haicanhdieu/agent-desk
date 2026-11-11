import type { Preview } from '@storybook/react-vite';

// Dark theme only. The real token sheet (`--bg` etc.) lands with Foundations in Task 2;
// the fallback keeps stories legible until then.
const preview: Preview = {
  parameters: {
    backgrounds: { disabled: true },
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  decorators: [
    (Story) => {
      document.body.style.colorScheme = 'dark';
      document.body.style.background = 'var(--bg, #15181E)';
      document.body.style.color = 'var(--text, #E3E6EB)';
      return Story();
    },
  ],
};
export default preview;
