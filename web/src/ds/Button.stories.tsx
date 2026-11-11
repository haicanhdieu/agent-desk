import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, IconButton } from './Button';
import { page } from './foundations.shared';

const variants = ['default', 'primary', 'go', 'danger', 'solid-danger', 'ghost'] as const;
const sizes = ['sm', 'md', 'lg'] as const;

function Gallery() {
  return (
    <div style={page}>
      <h1>Button</h1>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Variants by size</h2>
        {variants.map((v) => (
          <div key={v} className="row" style={{ gap: 12 }}>
            <span className="mono faint" style={{ width: 100 }}>{v}</span>
            {sizes.map((s) => (
              <Button key={s} variant={v} size={s}>{v} {s}</Button>
            ))}
          </div>
        ))}
      </section>
      <section className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Button icon="plus">With icon</Button>
        <Button iconRight="chevron-right">Icon right</Button>
        <Button aria-pressed={true} icon="runs">Grouped by ticket</Button>
        <Button disabled>Disabled</Button>
        <Button href="#link" iconRight="external">Link</Button>
        <Button href="#link" disabled>Disabled link</Button>
      </section>
      <section className="row" style={{ gap: 12 }}>
        <IconButton icon="more" aria-label="More actions" />
        <IconButton icon="panel" aria-label="Collapse context panel (])" />
        <IconButton icon="x" aria-label="Close" variant="default" />
      </section>
    </div>
  );
}

const meta: Meta = { title: 'Primitives/Button', component: Gallery };
export default meta;
export const AllVariants: StoryObj = {};
