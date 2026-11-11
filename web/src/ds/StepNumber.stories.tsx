import type { Meta, StoryObj } from '@storybook/react-vite';
import { StepNumber } from './StepNumber';
import { page } from './foundations.shared';

function Gallery() {
  return (
    <div style={page}>
      <h1>StepNumber</h1>
      <section className="row" style={{ gap: 12 }}>
        <StepNumber n={1} state="done" />
        <StepNumber n={2} state="current" />
        <StepNumber n={3} />
      </section>
    </div>
  );
}

const meta = { title: 'Primitives/StepNumber', component: Gallery } satisfies Meta<typeof Gallery>;
export default meta;
export const All: StoryObj<typeof meta> = {};
