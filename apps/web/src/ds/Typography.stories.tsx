import type { Meta, StoryObj } from '@storybook/react-vite';
import { page } from './foundations.shared';

const sizes = [
  '9_5',
  '11',
  '11_5',
  '12',
  '12_5',
  '13',
  '13_5',
  '14',
  '14_5',
  '15',
  '16',
  '18',
  '20',
  '22',
  '28',
  '34',
  '36',
];

function Scale({ family, label }: { family: string; label: string }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2>{label}</h2>
      {sizes.map((s) => (
        <div key={s} className="row" style={{ alignItems: 'baseline' }}>
          <span className="mono faint" style={{ width: 90 }}>
            --fs-{s}
          </span>
          <span style={{ fontFamily: `var(${family})`, fontSize: `var(--fs-${s})` }}>
            Agent Desk runs the work while you do something else
          </span>
        </div>
      ))}
      <div className="row" style={{ gap: 24, fontFamily: `var(${family})` }}>
        {[400, 500, 600].map((w) => (
          <span key={w} style={{ fontWeight: w }}>
            Weight {w}
          </span>
        ))}
      </div>
    </section>
  );
}

function Typography() {
  return (
    <div style={page}>
      <h1>Typography</h1>
      <Scale family="--sans" label="IBM Plex Sans" />
      <Scale family="--mono" label="IBM Plex Mono" />
    </div>
  );
}

const meta = { title: 'Foundations/Typography', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
export const Sizes: StoryObj<typeof meta> = { render: () => <Typography /> };
