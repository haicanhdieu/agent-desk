import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from './Icon';
import { StatusIcon } from './StatusIcon';
import { iconPaths, type IconName } from './icons';
import { page } from './foundations.shared';
import { RUN_STATUSES, statusTokens } from './tokens';

const names = Object.keys(iconPaths) as IconName[];
const sizes = [12, 14, 16, 18, 20] as const;

function Gallery() {
  return (
    <div style={page}>
      <h1>Icon</h1>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
        {names.map((n) => (
          <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <Icon name={n} size={20} />
            <span className="mono faint">{n}</span>
          </div>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2>StatusIcon</h2>
        {RUN_STATUSES.map((s) => (
          <div key={s} className="row" style={{ gap: 14 }}>
            <span className="mono faint" style={{ width: 90 }}>{s}</span>
            {sizes.map((z) => <StatusIcon key={z} status={s} size={z} />)}
            <span>{statusTokens[s].label}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

const meta: Meta = { title: 'Primitives/Icon', component: Gallery };
export default meta;
export const AllIcons: StoryObj = {};
