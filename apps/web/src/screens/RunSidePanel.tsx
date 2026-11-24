import { AppLink, Icon, InlineStatus, StatusIcon, TicketIcon, prStateTokens, statusTokens } from '@/ds';
import {
  ActorRef,
  ChainTimeline,
  EventLog,
  KeyValue,
  Meter,
  ModelTag,
  Note,
  RuleText,
  RunPromptSection,
  RunUsage,
  Section,
  SidePanel,
  SideRail,
  Stat,
  TicketSummary,
} from '@/components';
import type { RunDetailData } from '@/mocks';

export interface RunSidePanelProps {
  data: RunDetailData;
  collapsed?: boolean;
  onExpand?(): void;
  /** In-app hrefs of the Desk pages; a row shows plain text without its href (the caller may not open the Desk). */
  links?: { skills?: string; rules?: string; setup?: string };
  /** The project's run limit per ticket; defaults to the board's 10. */
  maxRunsPerTicket?: number;
}

export function RunSidePanel({ data, collapsed, onExpand, links, maxRunsPerTicket = 10 }: RunSidePanelProps) {
  const { run } = data;
  const t = run.ticket;
  if (collapsed) {
    const base = `${t.kind === 'pr' ? 'PR' : 'Issue'} #${t.number}`;
    const label = t.kind === 'pr' && t.prState ? `${prStateTokens[t.prState].label} ${base}` : base;
    const here = data.chain.findIndex((c) => c.here) + 1;
    return (
      <SideRail
        onExpand={onExpand}
        items={[
          { icon: <TicketIcon kind={t.kind} prState={t.prState} size={16} />, title: label },
          { icon: <StatusIcon status={run.status} size={16} />, title: statusTokens[run.status].label },
          { icon: <Icon name="rule" size={16} />, title: `Chain: ${here} of ${data.chain.length}` },
        ]}
      />
    );
  }

  const active = run.status === 'starting' || run.status === 'queued' || run.status === 'running';
  const pr = data.pullRequest;
  const prSection = pr ? (
    <Section title="Pull request">
      <TicketSummary ticket={pr.ticket} diffstat={pr.diffstat} />
    </Section>
  ) : null;
  const prNone = (
    <Section title="Pull request">
      <Note tone="faint" size={13}>
        None yet. A link appears here when the agent opens one.
      </Note>
    </Section>
  );

  const kv = [
    {
      term: 'Skill',
      value: links?.skills ? (
        <AppLink className="mono" href={links.skills}>
          {run.skill}
        </AppLink>
      ) : (
        <span className="mono">{run.skill}</span>
      ),
    },
    {
      term: 'Rule',
      value: links?.rules ? (
        <AppLink href={links.rules}>
          <RuleText rule={data.rule} command={run.command} />
        </AppLink>
      ) : (
        <RuleText rule={data.rule} command={run.command} />
      ),
    },
    {
      term: 'Triggered by',
      value: <ActorRef actor={run.triggeredBy} note={data.triggerNote} noteHref={t.href} />,
    },
    { term: 'Agent', value: <ModelTag agent={run.agent} model={run.model} /> },
    ...(data.setup
      ? [
          {
            term: 'Setup',
            value: (
              <>
                {links?.setup ? (
                  <AppLink href={links.setup}>Version {data.setup.version}</AppLink>
                ) : (
                  <>Version {data.setup.version}</>
                )}
                {data.setup.note && (
                  <>
                    {' '}
                    <span className="faint">{data.setup.note}</span>
                  </>
                )}
              </>
            ),
          },
        ]
      : []),
    { term: 'Started', value: <span className="num">{data.startedAt}</span> },
    ...(data.endedAt ? [{ term: 'Ended', value: <span className="num">{data.endedAt}</span> }] : []),
  ];

  return (
    <SidePanel>
      <Section title="Ticket">
        <TicketSummary ticket={t} />
      </Section>
      {data.idle && (
        <Section title="Waiting for you">
          <Stat
            left={
              <>
                Idle since <b>{data.idle.since}</b>
              </>
            }
            right={
              <InlineStatus tone="idle" icon={<Icon name="pause" size={13} />}>
                Timer paused
              </InlineStatus>
            }
          />
          <Note>
            With nobody attached it ends as succeeded after 30 minutes. Close this tab now and it ends at{' '}
            <b>{data.idle.endsAt}</b>.
          </Note>
          <Note>{data.idle.slotNote}</Note>
        </Section>
      )}
      {!active && prSection}
      <Section title="Run">
        <KeyValue items={kv} />
      </Section>
      {data.finalPrompt !== undefined && (
        <RunPromptSection finalPrompt={data.finalPrompt} defaultOpen={data.promptOpen} />
      )}
      {data.time && (
        <Section title="Time">
          <Stat
            left={
              <>
                Elapsed <b>{data.time.elapsed}</b>
              </>
            }
            right={
              <span className="faint">
                limit <span className="num">{data.time.limit}</span>
              </span>
            }
          />
          <Meter
            value={data.time.percent}
            max={100}
            tone={data.time.percent >= 100 ? 'late' : 'run'}
            aria-label={`${data.time.percent}% of run time limit used`}
          />
        </Section>
      )}
      {data.usage && (
        <RunUsage
          usage={data.usage}
          initialOpen={!data.usageCollapsed}
          initialModelsOpen={!data.usageModelsCollapsed}
        />
      )}
      <Section title="Chain on this ticket" aside={<span className="faint num">max {maxRunsPerTicket} runs</span>}>
        <ChainTimeline steps={data.chain} />
      </Section>
      {active && prNone}
      {run.status === 'running' && data.lifecycle && (
        <Section title="Lifecycle">
          <EventLog events={data.lifecycle} />
        </Section>
      )}
    </SidePanel>
  );
}
