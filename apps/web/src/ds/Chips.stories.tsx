import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommandChip } from './CommandChip';
import { LabelChip } from './LabelChip';
import { TicketIcon, TicketRef } from './TicketRef';
import { PR_STATES, type PrState } from './tokens';
import { page } from './foundations.shared';

const prStates: (PrState | undefined)[] = [...PR_STATES, undefined];

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
      <section className="row" style={{ gap: 16 }}>
        <TicketRef kind="issue" number={139} href="https://github.com/acme/invoicer-api/issues/139" />
        <TicketRef kind="pr" number={148} href="https://github.com/acme/invoicer-api/pull/148" />
        <TicketRef kind="issue" number={142} short href="" />
      </section>
      <section className="row" style={{ gap: 16 }}>
        {prStates.map((s) => (
          <TicketRef key={s ?? 'unknown'} kind="pr" number={148} prState={s} />
        ))}
      </section>
      <section className="row" style={{ gap: 16 }}>
        {prStates.map((s) => (
          <TicketRef
            key={s ?? 'unknown'}
            kind="pr"
            number={148}
            prState={s}
            href="https://github.com/acme/invoicer-api/pull/148"
          />
        ))}
      </section>
      <section className="row" style={{ gap: 16 }}>
        <TicketRef kind="issue" number={142} prState="merged" />
        {PR_STATES.map((s) => (
          <span key={s} className="row" style={{ gap: 8 }}>
            <TicketIcon kind="pr" prState={s} />
            <TicketIcon kind="pr" prState={s} size={16} />
          </span>
        ))}
      </section>
    </div>
  );
}

const meta = { title: 'Primitives/Chips', component: Gallery } satisfies Meta<typeof Gallery>;
export default meta;
export const All: StoryObj<typeof meta> = {};
