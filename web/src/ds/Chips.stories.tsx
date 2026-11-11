import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommandChip } from './CommandChip';
import { LabelChip } from './LabelChip';
import { TicketRef } from './TicketRef';
import { page } from './foundations.shared';

function Gallery() {
  return (
    <div style={page}>
      <h1>Chips</h1>
      <section className="row" style={{ gap: 12 }}>
        <CommandChip>/agent-desk run</CommandChip>
        <CommandChip>npm test</CommandChip>
      </section>
      <section className="row" style={{ gap: 8 }}>
        <LabelChip name="user-story" color="var(--label-story)" />
        <LabelChip name="api" color="var(--label-api)" />
        <LabelChip name="bug" color="var(--label-bug)" />
        <LabelChip name="e2e" color="var(--label-e2e)" />
        <LabelChip name="Unsaved changes" tone="idle" />
        <LabelChip name="removable" color="var(--label-story)" onRemove={() => {}} />
      </section>
      <section className="row" style={{ gap: 16 }}>
        <TicketRef kind="issue" number={139} />
        <TicketRef kind="pr" number={148} />
        <TicketRef kind="issue" number={142} short />
      </section>
    </div>
  );
}

const meta = { title: 'Primitives/Chips', component: Gallery } satisfies Meta<typeof Gallery>;
export default meta;
export const All: StoryObj<typeof meta> = {};
