import type { Meta, StoryObj } from '@storybook/react-vite';
import { page } from './foundations.shared';

const radii = ['3', '4', '5', '6', '8', '9', '10', 'pill'];
const spaces = [2, 4, 6, 8, 10, 12, 14, 16, 18, 24];

function RadiusAndSpacing() {
  return (
    <div style={page}>
      <h1>Radius and spacing</h1>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Radius</h2>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          {radii.map((r) => (
            <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 72, height: 48, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: `var(--radius-${r})` }} />
              <span className="mono faint">--radius-{r}</span>
            </div>
          ))}
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2>Spacing (px, used for gap and padding)</h2>
        {spaces.map((s) => (
          <div key={s} className="row">
            <span className="mono faint" style={{ width: 40 }}>{s}</span>
            <div style={{ width: s, height: 12, background: 'var(--accent)' }} />
          </div>
        ))}
      </section>
    </div>
  );
}

const meta = { title: 'Foundations/Radius and spacing', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
export const Tokens: StoryObj<typeof meta> = { render: () => <RadiusAndSpacing /> };
