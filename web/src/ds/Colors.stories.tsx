import type { Meta, StoryObj } from '@storybook/react-vite';
import { page, grid, readVar } from './foundations.shared';
import { RUN_STATUSES, statusTokens } from './tokens';

const groups: Record<string, string[]> = {
  Surface: ['bg', 'panel', 'raised', 'line', 'line2', 'input-bg', 'cmd-bg', 'row-group', 'row-needs', 'term', 'term-bar', 'chrome-bg', 'notify-bg', 'select-bg'],
  Text: ['text', 'muted', 'faint', 'accent', 'cmd-text', 'term-text', 'ln'],
  Status: ['run', 'idle', 'ok', 'fail', 'late', 'off'],
  Terminal: ['term-dim', 'term-bold', 'term-cyan', 'term-green', 'term-red', 'term-yellow', 'term-magenta', 'term-accent', 'term-add-bg', 'term-del-bg'],
  Banner: ['banner-warn-bg', 'banner-warn-line', 'banner-err-bg', 'banner-err-line', 'banner-late-bg', 'banner-late-line', 'banner-ok-bg', 'banner-ok-line', 'banner-idle-bg', 'banner-idle-line', 'danger-bg'],
};

function Swatch({ name }: { name: string }) {
  const value = readVar(name);
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

const meta = { title: 'Foundations/Colors', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
export const Palette: StoryObj<typeof meta> = { render: () => <Colors /> };
