import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';
import { page } from './foundations.shared';

function Gallery() {
  return (
    <div style={page}>
      <h1>Avatar</h1>
      <section className="row" style={{ gap: 12 }}>
        <Avatar initials="MN" title="Minh Nguyen" />
        <Avatar initials="MN" size="sm" title="Minh Nguyen" />
        <Avatar kind="bot" title="Agent" />
        <Avatar kind="bot" size="sm" title="Agent" />
      </section>
    </div>
  );
}

const meta = { title: 'Primitives/Avatar', component: Gallery } satisfies Meta<typeof Gallery>;
export default meta;
export const All: StoryObj<typeof meta> = {};
