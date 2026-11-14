import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBadge } from './StatusBadge';
import { RUN_STATUSES } from './tokens';
import { page } from './foundations.shared';

function Gallery() {
  return (
    <div style={page}>
      <h1>StatusBadge</h1>
      {(['text', 'pill'] as const).map((v) => (
        <section key={v} className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <span className="mono faint" style={{ width: 40 }}>
            {v}
          </span>
          {RUN_STATUSES.map((s) => (
            <StatusBadge key={s} status={s} variant={v} />
          ))}
        </section>
      ))}
      <section className="row" style={{ gap: 16 }}>
        <span className="mono faint" style={{ width: 40 }}>
          custom
        </span>
        <StatusBadge status="idle" variant="pill">
          1 run
        </StatusBadge>
        <StatusBadge status="running" variant="pill">
          2 runs
        </StatusBadge>
      </section>
    </div>
  );
}

const meta = { title: 'Primitives/StatusBadge', component: Gallery } satisfies Meta<typeof Gallery>;
export default meta;
export const All: StoryObj<typeof meta> = {};

/** Declared finish: its own label and tick glyph, not "Needs you". */
export const Done: StoryObj<typeof StatusBadge> = {
  render: () => (
    <div style={page}>
      <section className="row" style={{ gap: 16 }}>
        <StatusBadge status="done" />
        <StatusBadge status="done" variant="pill" />
      </section>
    </div>
  ),
};
