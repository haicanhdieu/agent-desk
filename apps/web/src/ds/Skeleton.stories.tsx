import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from './Skeleton';

function Gallery() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, width: 360 }}>
      <Skeleton variant="block" height={96} />
      <Skeleton variant="text" lines={1} />
      <Skeleton variant="text" lines={3} />
      <Skeleton variant="block" width={120} height={32} />
    </div>
  );
}

const meta: Meta = { title: 'Primitives/Skeleton', component: Gallery };
export default meta;
export const Variants: StoryObj = {};
