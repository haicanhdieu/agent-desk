import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { Pagination, type PaginationProps } from './Pagination';
import styles from './Pagination.module.css';

const noop = () => undefined;

const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  parameters: { layout: 'padded' },
  args: {
    page: 25,
    pageSize: 20,
    total: 1000,
    onPageChange: noop,
    onPageSizeChange: noop,
  },
} satisfies Meta<typeof Pagination>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MiddlePage: Story = {};
export const FirstPage: Story = { args: { page: 1 } };
export const LastPage: Story = { args: { page: 50 } };
export const FewPages: Story = { args: { page: 2, total: 57 } };
export const ManyPages: Story = { args: { page: 312, total: 12480 } };
/** 80 typed on a 50-page list: Go clamps to page 50. */
export const JumpOutOfRange: Story = {
  args: { page: 50, total: 1000 },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('textbox', { name: 'Go to page' }), '80');
  },
};
export const Loading: Story = { args: { busy: true } };
/** The control draws nothing; the note stands in for it. */
export const Hidden: Story = {
  args: { total: 20 },
  render: (args) => (
    <div>
      <Pagination {...args} />
      <p className={styles.note}>No control at 20 rows or fewer.</p>
    </div>
  ),
};

const inWidth = (width: number): Story['decorators'] => [
  (S) => (
    <div style={{ width }}>
      <S />
    </div>
  ),
];
export const Compact1069: Story = { decorators: inWidth(1069) };
export const Compact789: Story = { decorators: inWidth(789) };
export const Compact589: Story = { decorators: inWidth(589) };
export const Compact359: Story = { decorators: inWidth(359) };

const boardStates: { title: string; note: string; props: Partial<PaginationProps> }[] = [
  { title: 'Middle page, gaps on both sides.', note: 'Page 25 of 50 (1,000 rows).', props: {} },
  { title: 'First page.', note: 'Previous is disabled.', props: { page: 1 } },
  { title: 'Last page.', note: 'Next is disabled.', props: { page: 50 } },
  { title: 'Few pages.', note: '3 pages: every page shows, no "…".', props: { page: 2, total: 57 } },
  { title: 'Many pages.', note: 'Page 312 of 624 (12,480 rows).', props: { page: 312, total: 12480 } },
  { title: 'Loading between pages.', note: 'Every control is disabled until the page arrives.', props: { busy: true } },
  { title: 'Hidden.', note: '20 rows or fewer: the control is not drawn.', props: { total: 20 } },
];

/** Every state stacked at full width, in the board's order. */
export const Board: Story = {
  render: (args) => (
    <div className={styles.board}>
      {boardStates.map((s) => (
        <div key={s.title} className={styles.card}>
          <div className={styles.cardBody}>
            <Pagination {...args} {...s.props} label={`Pagination: ${s.title}`} />
          </div>
          <div className={styles.cardNote}>
            <b className={styles.cardTitle}>{s.title}</b> {s.note}
          </div>
        </div>
      ))}
    </div>
  ),
};
