import { Icon, InlineStatus, StatusIcon, statusTokens } from '@/ds';
import {
  ActorRef, ChainTimeline, EventLog, KeyValue, Meter, ModelTag, Note, RuleText, Section, SidePanel, SideRail, Stat,
  TicketSummary,
} from '@/components';
import type { RunDetailData } from '@/mocks';

export interface RunSidePanelProps {
  data: RunDetailData;
  collapsed?: boolean;
  onExpand?(): void;
}

export function RunSidePanel({ data, collapsed, onExpand }: RunSidePanelProps) {
  const { run } = data;
  const t = run.ticket;
  if (collapsed) {
    const label = `${t.kind === 'pr' ? 'PR' : 'Issue'} #${t.number}`;
    const here = data.chain.findIndex((c) => c.here) + 1;
    return (
      <SideRail
        onExpand={onExpand}
        items={[
          { icon: <Icon name={t.kind === 'pr' ? 'pull-request' : 'issue'} size={16} />, title: label },
          { icon: <StatusIcon status={run.status} size={16} />, title: statusTokens[run.status].label },
          { icon: <Icon name="rule" size={16} />, title: `Chain: ${here} of ${data.chain.length}` },
        ]}
      />
    );
  }

  const active = run.status === 'starting' || run.status === 'queued' || run.status === 'running';
  const pr = data.pullRequest;
  const prSection = pr ? (
    <Section title="Pull request"><TicketSummary ticket={pr.ticket} diffstat={pr.diffstat} /></Section>
  ) : null;
  const prNone = (
    <Section title="Pull request"><Note tone="faint" size={13}>None yet. A link appears here when the agent opens one.</Note></Section>
  );

  const kv = [
    { term: 'Skill', value: <a className="mono" href="/desk/skills">{run.skill}</a> },
    { term: 'Rule', value: <a href="/desk/rules"><RuleText rule={data.rule} command={run.command} /></a> },
    {
      term: 'Triggered by',
      value: <ActorRef actor={run.triggeredBy} note={data.triggerNote} noteHref={t.href} />,
    },
    { term: 'Agent', value: <ModelTag agent={run.agent} model={run.model} /> },
    { term: 'Started', value: <span className="num">{data.startedAt}</span> },
    ...(data.endedAt ? [{ term: 'Ended', value: <span className="num">{data.endedAt}</span> }] : []),
  ];

  return (
    <SidePanel>
      <Section title="Ticket"><TicketSummary ticket={t} /></Section>
      {data.idle && (
        <Section title="Waiting for you">
          <Stat
            left={<>Idle since <b>{data.idle.since}</b></>}
            right={<InlineStatus tone="idle" icon={<Icon name="pause" size={13} />}>Timer paused</InlineStatus>}
          />
          <Note>With nobody attached it ends as succeeded after 10 minutes. Close this tab now and it ends at <b>{data.idle.endsAt}</b>.</Note>
          <Note>{data.idle.slotNote}</Note>
        </Section>
      )}
      {!active && prSection}
      <Section title="Run"><KeyValue items={kv} /></Section>
      {data.time && (
        <Section title="Time">
          <Stat
            left={<>Elapsed <b>{data.time.elapsed}</b></>}
            right={<span className="faint">limit <span className="num">{data.time.limit}</span></span>}
          />
          <Meter
            value={data.time.percent}
            max={100}
            tone={data.time.percent >= 100 ? 'late' : 'run'}
            aria-label={`${data.time.percent}% of run time limit used`}
          />
        </Section>
      )}
      <Section title="Chain on this ticket" aside={<span className="faint num">max 10 runs</span>}>
        <ChainTimeline steps={data.chain} />
      </Section>
      {active && prNone}
      {run.status === 'running' && data.lifecycle && (
        <Section title="Lifecycle"><EventLog events={data.lifecycle} /></Section>
      )}
    </SidePanel>
  );
}
