import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, StatusIcon } from '@/ds';
import { bot, user } from '@/mocks';
import { ActorRef, ModelTag, Note, PopoverCard, RuleText, Stat } from './RunFacts';

const meta = {
  title: 'Components/Run facts',
  decorators: [(S) => <div style={{ width: 312, display: 'flex', flexDirection: 'column', gap: 12 }}><S /></div>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Notes: Story = {
  render: () => (
    <>
      <Note>With nobody attached it ends as succeeded after 10 minutes.</Note>
      <Note tone="faint" size={13}>None yet. A link appears here when the agent opens one.</Note>
    </>
  ),
};
export const Stats: Story = {
  render: () => <Stat left={<>Elapsed <b>7:40</b></>} right={<span className="faint">limit <span className="num">30:00</span></span>} />,
};
export const Actors: Story = {
  render: () => (
    <>
      <div><ActorRef actor={user} note="comment" noteHref="#" /></div>
      <div><ActorRef actor={bot} note="comment by run 60" noteHref="#" /></div>
      <div><RuleText rule="/code-build on issues labelled user-story" command="/code-build" /></div>
      <div><ModelTag agent="Claude" model="opus" /></div>
    </>
  ),
};
export const PopoverContents: Story = {
  render: () => (
    <>
      <PopoverCard title="Cancel run 61?" body="The pod is stopped now." actions={<Button size="sm" variant="solid-danger">Cancel run</Button>} />
      <PopoverCard icon={<StatusIcon status="starting" size={18} />} title="Connection to the terminal lost" body="Retrying in 4 s." actions={<Button size="sm" icon="refresh">Reconnect now</Button>} />
    </>
  ),
};
