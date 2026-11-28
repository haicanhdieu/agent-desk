import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShellFrame } from '@/screens/shellFrame';
import { orgSwitchFixtures } from '@/mocks';
import { AppShell, type AppShellProps } from './AppShell';
import { NO_PAGE_CRUMBS } from './pageTitle';
import { SubNav, type SubNavGroup } from './SubNav';
import { TopBar, type TopBarProps } from './TopBar';

const user = { login: 'kim-hale', initials: 'KH' };
const org = {
  orgHref: (o: { slug: string }) => `/o/${o.slug}`,
  createHref: '/platform/orgs/new',
  ...orgSwitchFixtures.oneOrg,
};
const barProps: TopBarProps = { user, org, crumbs: NO_PAGE_CRUMBS };

const groups: SubNavGroup[] = [
  {
    heading: 'Configure',
    items: [
      { label: 'Skills', href: '#skills', active: true },
      { label: 'Routing rules', href: '#rules' },
      { label: 'Agent & settings', href: '#agent' },
    ],
  },
];
const longGroups: SubNavGroup[] = Array.from({ length: 6 }, (_, g) => ({
  heading: `Group ${g + 1}`,
  items: Array.from({ length: 6 }, (_, i) => ({ label: `Page ${g + 1}.${i + 1}`, href: `#p${g}${i}` })),
}));

function Page({ children = 'Page content' }: { children?: string }) {
  return <div style={{ padding: 24, color: 'var(--muted)' }}>{children}</div>;
}

function Demo({
  menuMode = 'none',
  groups: menuGroups = groups,
  fill,
  page,
  ...rest
}: Partial<Omit<AppShellProps, 'topBar' | 'children'>> & {
  groups?: SubNavGroup[];
  fill?: boolean;
  page?: React.ReactNode;
}) {
  const [open, setOpen] = useState(menuMode === 'drawer' || menuMode === 'wizard');
  const drawer = menuMode === 'drawer' || menuMode === 'wizard';
  const menu = (
    <SubNav
      aria-label="Menu"
      groups={menuGroups}
      collapsed={menuMode === 'collapsed'}
      onClose={drawer ? () => setOpen(false) : undefined}
    />
  );
  return (
    <ShellFrame
      {...rest}
      fill={fill}
      menuMode={menuMode === 'wizard' ? 'drawer' : menuMode}
      menu={menu}
      drawerOpen={open}
      onDrawerClose={() => setOpen(false)}
      topBar={{ ...barProps, onOpenMenu: drawer ? () => setOpen(true) : undefined, menuOpen: open }}
    >
      {page ?? <Page />}
    </ShellFrame>
  );
}

const meta = {
  title: 'Components/AppShell',
  component: Demo,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <div style={{ height: 600 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

const phone = { decorators: [(S: () => React.JSX.Element) => <div style={{ width: 390, height: 844 }}>{S()}</div>] };

export const MenuFull: Story = { args: { menuMode: 'full', height: 600 } };
export const MenuCollapsed: Story = { args: { menuMode: 'collapsed', height: 600 } };
export const MenuNone: Story = { args: { menuMode: 'none', height: 600 } };
export const MenuDrawerOpen390: Story = { args: { menuMode: 'drawer', height: 844 }, ...phone };
export const MenuDrawerClosed390: Story = { args: { menuMode: 'none', height: 844 }, ...phone };
export const FillLongMenuShortCanvas: Story = {
  args: {
    menuMode: 'full',
    fill: true,
    groups: longGroups,
    page: <div style={{ minHeight: 120, background: 'var(--panel)', padding: 16 }}>Short canvas</div>,
  },
};

/** A wizard slot: the steps menu a page portals in; shown here as plain content in the slot. */
export const WizardSlotInline: Story = {
  render: () => (
    <AppShell
      height={600}
      topBar={<TopBar {...barProps} />}
      menuMode="wizard"
      menu={<SubNav aria-label="Setup steps" groups={groups} />}
    >
      <Page />
    </AppShell>
  ),
};
