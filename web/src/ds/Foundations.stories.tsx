import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { RUN_STATUSES, statusTokens } from './tokens';

const page: CSSProperties = { padding: 24, display: 'flex', flexDirection: 'column', gap: 28 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 };

const groups: Record<string, string[]> = {
  Surface: ['bg', 'panel', 'raised', 'line', 'line2', 'input-bg', 'cmd-bg', 'row-group', 'row-needs', 'term', 'term-bar', 'chrome-bg', 'notify-bg', 'select-bg'],
  Text: ['text', 'muted', 'faint', 'accent', 'cmd-text', 'term-text', 'ln'],
  Status: ['run', 'idle', 'ok', 'fail', 'late', 'off'],
  Terminal: ['term-dim', 'term-bold', 'term-cyan', 'term-green', 'term-red', 'term-yellow', 'term-magenta', 'term-accent', 'term-add-bg', 'term-del-bg'],
  Banner: ['banner-warn-bg', 'banner-warn-line', 'banner-err-bg', 'banner-err-line', 'banner-late-bg', 'banner-late-line', 'banner-ok-bg', 'banner-ok-line', 'banner-idle-bg', 'banner-idle-line', 'danger-bg'],
};

function useVarValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

function Swatch({ name }: { name: string }) {
  const value = useVarValue(name);
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-8)', overflow: 'hidden', background: 'var(--panel)' }}>
      <div style={{ height: 48, background: `var(--${name})`, borderBottom: '1px solid var(--line)' }} />
      <div style={{ padding: '6px 10px' }}>
        <div className="mono">--{name}</div>
        <div className="mono faint">{value}</div>
      </div>
    </div>
  );
}

function Colors() {
  return (
    <div style={page}>
      <h1>Colors</h1>
      {Object.entries(groups).map(([group, names]) => (
        <section key={group} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>{group}</h2>
          <div style={grid}>{names.map((n) => <Swatch key={n} name={n} />)}</div>
        </section>
      ))}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Run status</h2>
        <div style={grid}>
          {RUN_STATUSES.map((s) => (
            <div key={s} className="row" style={{ color: `var(${statusTokens[s].colorVar})` }}>
              <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-pill)', background: 'currentColor' }} />
              <span>{statusTokens[s].label}</span>
              <span className="mono faint">{s}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const sizes = ['9_5', '11', '11_5', '12', '12_5', '13', '13_5', '14', '14_5', '15', '16', '18', '20', '22', '28', '34', '36'];

function Scale({ family, label }: { family: string; label: string }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2>{label}</h2>
      {sizes.map((s) => (
        <div key={s} className="row" style={{ alignItems: 'baseline' }}>
          <span className="mono faint" style={{ width: 90 }}>--fs-{s}</span>
          <span style={{ fontFamily: `var(${family})`, fontSize: `var(--fs-${s})` }}>
            Agent Desk runs the work while you do something else
          </span>
        </div>
      ))}
      <div className="row" style={{ gap: 24, fontFamily: `var(${family})` }}>
        {[400, 500, 600].map((w) => <span key={w} style={{ fontWeight: w }}>Weight {w}</span>)}
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

const meta = { title: 'Foundations', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Colours: Story = { name: 'Colors', render: () => <Colors /> };
export const TypographyStory: Story = { name: 'Typography', render: () => <Typography /> };
export const RadiusSpacing: Story = { name: 'Radius and spacing', render: () => <RadiusAndSpacing /> };
