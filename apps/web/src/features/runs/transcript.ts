import type { RunTranscriptResponse } from '@agentdesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { TranscriptItem } from '@/components';
import type { RunDetailData } from '@/mocks/types';
import { plainText, type TerminalArea } from './detail.map';
import { clockTime } from './map';
import { runsQueries } from './queries';
import { FINAL_LOG_RECHECK_MS } from './useRunEvents';

/**
 * Pages (pages[0] is the newest) as oldest-first items. The lowest-seq user entry is the prompt once no older page
 * exists; later user entries are the person's messages. Text is untrusted and goes through plainText.
 */
export function transcriptItems(pages: RunTranscriptResponse[], agentName: string): TranscriptItem[] {
  const entries = [...pages].reverse().flatMap((p) => p.items);
  const oldest = pages.at(-1);
  const complete = oldest !== undefined && oldest.nextBefore === null;
  const promptSeq = complete ? entries.find((e) => e.kind === 'user')?.seq : undefined;
  return entries.map((e) => ({
    key: String(e.seq),
    kind: e.kind,
    ...(e.kind === 'user' && { label: e.seq === promptSeq ? 'Prompt' : 'You' }),
    ...(e.kind === 'agent' && { label: agentName }),
    time: clockTime(e.at),
    ...(e.kind === 'tool' && e.tool !== null && { tool: plainText(e.tool) }),
    text: plainText(e.text),
    truncated: e.truncated,
  }));
}

/** The terminal bar's connection while the Transcript shows. */
export function transcriptConnection(area: TerminalArea, empty: boolean): RunDetailData['connection'] {
  if (area === 'pausing') return { state: 'none', label: 'Ending…' };
  if (area === 'paused') return { state: 'ended', label: empty ? 'Paused' : 'Paused, read-only' };
  return { state: 'ended', label: empty ? 'Ended' : 'Ended, read-only' };
}

const GONE: TerminalArea[] = ['paused', 'ended', 'expired'];

/**
 * Refetches the transcript when the pod goes away (the area turns from live or pausing to paused, ended or
 * expired), and once more after FINAL_LOG_RECHECK_MS in case the last lines were stored just after.
 */
export function useTranscriptReload(org: string, projectId: string, number: number, area: TerminalArea): void {
  const qc = useQueryClient();
  const prev = useRef({ area, number });
  useEffect(() => {
    const before = prev.current;
    prev.current = { area, number };
    const turned =
      before.number === number && (before.area === 'live' || before.area === 'pausing') && GONE.includes(area);
    if (!turned) return undefined;
    const queryKey = runsQueries.transcript(org, projectId, number).queryKey;
    void qc.invalidateQueries({ queryKey });
    const recheck = setTimeout(() => void qc.invalidateQueries({ queryKey }), FINAL_LOG_RECHECK_MS);
    return () => clearTimeout(recheck);
  }, [area, qc, org, projectId, number]);
}
