import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner, type BannerTone } from './Banner';
import { Button } from './Button';
import { Icon } from './Icon';
import { StatusIcon } from './StatusIcon';
import { page } from './foundations.shared';

const tones: BannerTone[] = ['warn', 'err', 'late', 'ok', 'off', 'idle'];

function Gallery() {
  return (
    <div style={{ ...page, maxWidth: 720 }}>
      <h1>Banner</h1>
      <h2>Tones</h2>
      {tones.map((t) => (
        <Banner key={t} tone={t} icon={<Icon name="warning" size={16} />} title={`Tone: ${t}`}>
          Static by default, so it is not announced on page load.
        </Banner>
      ))}
      <h2>With actions</h2>
      <Banner
        tone="warn"
        icon={<Icon name="key" size={16} />}
        title="Reconnect GitHub"
        actions={
          <Button size="sm" variant="primary">
            Reconnect
          </Button>
        }
      >
        The token expired.
      </Banner>
      <h2>Flush (attached to the terminal)</h2>
      <Banner tone="ok" flush icon={<StatusIcon status="succeeded" size={16} />} title="Run succeeded">
        Finished in 4m 12s.
      </Banner>
      <h2>Prominent</h2>
      <Banner
        tone="err"
        prominent
        icon={<StatusIcon status="failed" size={20} />}
        title="Run failed"
        actionsPlacement="below"
        actions={
          <>
            <Button size="sm">View log</Button>
            <Button size="sm" variant="primary">
              Retry
            </Button>
          </>
        }
      >
        The agent exited with code 1.
      </Banner>
      <h2>Live (assertive)</h2>
      <Banner tone="err" live="assertive" icon={<Icon name="info" size={16} />} title="Connection lost">
        Reconnecting automatically.
      </Banner>
    </div>
  );
}

const meta: Meta = { title: 'Primitives/Banner', component: Gallery, parameters: { layout: 'fullscreen' } };
export default meta;
export const Default: StoryObj = {};
