import type { Meta, StoryObj } from '@storybook/react-vite';
import { CountBadge } from './CountBadge';
import { page } from './foundations.shared';

function Gallery() {
  return (
    <div style={page}>
      <h1>CountBadge</h1>
      <section className="row" style={{ gap: 12 }}>
        <CountBadge count={3} />
        <CountBadge count={3} label="needs you" />
        <span className="faint">count 0 renders nothing:</span>
        <CountBadge count={0} />
      </section>
    </div>
  );
}

const meta = { title: 'Primitives/CountBadge', component: Gallery } satisfies Meta<typeof Gallery>;
export default meta;
export const All: StoryObj<typeof meta> = {};
