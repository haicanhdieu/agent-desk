import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TabPanel, Tabs } from './Tabs';
import { page } from './foundations.shared';

type V = 'script' | 'environment';
const tabs: { value: V; label: string }[] = [
  { value: 'script', label: 'Setup script' },
  { value: 'environment', label: 'Environment' },
];

function Demo({ prefix, note }: { prefix: string; note?: boolean }) {
  const [value, setValue] = useState<V>('script');
  return (
    <>
      <Tabs<V> tabs={tabs} value={value} onChange={setValue} label="Setup sections" idPrefix={prefix} />
      <TabPanel value="script" active={value} idPrefix={prefix}>
        <p>Setup script panel.</p>
      </TabPanel>
      <TabPanel value="environment" active={value} idPrefix={prefix}>
        <p>Environment panel.</p>
      </TabPanel>
      {note && (
        <p>
          Keyboard: Left and Right Arrow move between tabs and select; Home and End jump to the first and last tab; Tab
          moves into the panel.
        </p>
      )}
    </>
  );
}

const meta: Meta = { title: 'Primitives/Tabs', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div style={{ ...page, maxWidth: 720 }}>
      <Demo prefix="tabs-default" />
    </div>
  ),
};

export const Narrow: Story = {
  render: () => (
    <div style={{ ...page, width: 240 }}>
      <Demo prefix="tabs-narrow" />
    </div>
  ),
};

export const KeyboardNote: Story = {
  render: () => (
    <div style={{ ...page, maxWidth: 720 }}>
      <Demo prefix="tabs-keyboard" note />
    </div>
  ),
};
