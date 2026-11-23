import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RUN_STATUSES } from '@/ds';
import {
  agentSettings,
  auditRows,
  memberRows,
  manyPickerOptions,
  memberPickerOptions,
  pagedProjectMemberRows,
  projectAuditRows,
  projectAuditRowsExpired,
  projectAuditRowsNoEmail,
  projectMemberRows,
  projectRoleCards,
  orgSettingsFixtures,
  pagedAuditLastPage,
  pagedAuditRows,
  roleCards,
  checklistSteps,
  connectionCopy,
  connections,
  connectionWarnings,
  DEFAULT_POLL_INTERVAL,
  ignored,
  invitationCards,
  invitationDetails,
  invitationLink,
  inviteProjectOptions,
  inviteRoleOptions,
  linkedGroups,
  menuWarning,
  orgInvitationRows,
  orgOptions,
  orgSwitchFixtures,
  pagedInvitationRows,
  pendingInvitationsCount,
  pollIntervals,
  projects,
  rules,
  runDetails,
  runs,
  skills,
  terminalByRun,
  ticketGroups,
} from '@/mocks';
import { tenantMemberFixtures } from '@/mocks/dto/access';
import { AUDIT_MOCK_NOW } from '@/mocks/dto/audit';
import { ids } from '@/mocks/dto/ids';

const ACTIVE = ['queued', 'starting', 'running', 'idle'];

describe('mock fixtures', () => {
  it('uses valid run statuses and unique run ids', () => {
    for (const r of runs) expect(RUN_STATUSES).toContain(r.status);
    const ids = runs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([52, 54, 55, 56, 57, 60, 61, 62, 63]);
  });

  it('flattens ticketGroups into runs', () => {
    expect(
      ticketGroups
        .flatMap((g) => g.runs)
        .map((r) => r.id)
        .sort((a, b) => a - b),
    ).toEqual(runs.map((r) => r.id));
  });

  it('has at most one active run per ticket and skill', () => {
    const seen = new Set<string>();
    for (const r of runs.filter((x) => ACTIVE.includes(x.status))) {
      const key = `${r.ticket.kind}#${r.ticket.number}/${r.skill}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  const everyList = [ticketGroups, ...Object.values(linkedGroups)];

  it('keeps every group within its run limit', () => {
    for (const g of everyList.flat()) {
      expect(g.runsUsed).toBeLessThanOrEqual(g.runsMax);
      for (const l of g.linked ?? []) expect(l.runsUsed).toBeLessThanOrEqual(g.runsMax);
    }
  });

  it('writes each merged group chain note from its per-ticket counts', () => {
    const merged = everyList.flat().filter((g) => g.linked?.length);
    expect(merged.length).toBeGreaterThan(0);
    for (const g of merged) {
      expect(g.chainNote).toContain(`(${g.runsUsed} of ${g.runsMax} runs)`);
      for (const l of g.linked ?? []) expect(g.chainNote).toContain(`(${l.runsUsed} of ${g.runsMax} runs)`);
    }
  });

  it('leads every merged group with its issue and lists its PRs by number', () => {
    for (const g of everyList.flat().filter((x) => x.linked?.length)) {
      expect(g.ticket.kind).toBe('issue');
      const prs = (g.linked ?? []).map((l) => l.ticket.number);
      expect(prs).toEqual([...prs].sort((a, b) => a - b));
      expect(g.chainNote?.startsWith(`Issue #${g.ticket.number} (`)).toBe(true);
    }
  });

  it('matches PRD defaults', () => {
    expect(agentSettings.maxConcurrent).toBe(2);
    expect(agentSettings.maxRunsPerTicket).toBe(10);
    expect(agentSettings.timeoutMinutes).toBe(30);
    expect(agentSettings.idleEndMinutes).toBe(30);
  });

  it('points every enabled skill rule at an existing skill unless it carries a warning', () => {
    const names = skills.map((s) => s.name);
    for (const r of rules.filter((x) => x.enabled && !x.warning && x.kind !== 'prompt')) {
      expect(names).toContain(r.skill);
    }
    expect(rules.find((r) => r.warning)?.command).toBe('docs-update');
  });

  it('gives every prompt rule a prompt within the limit and no skill', () => {
    const prompts = rules.filter((r) => r.kind === 'prompt');
    expect(prompts.map((r) => r.command)).toEqual(['triage']);
    for (const r of prompts) {
      expect(r.skill).toBe('');
      expect(r.prompt?.length).toBeGreaterThan(0);
      expect(r.prompt?.length).toBeLessThanOrEqual(4000);
    }
  });

  it('has the five boards of ignored commands and four projects', () => {
    expect(ignored).toHaveLength(5);
    expect(projects.map((p) => p.name)).toEqual(['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs']);
  });

  it('gives each project a trigger mode and a status that fits it', () => {
    expect(projects.map((p) => [p.connection.mode, p.connection.tone])).toEqual([
      ['webhook', 'ok'],
      ['polling', 'ok'],
      ['webhook', 'warn'],
      ['polling', 'err'],
    ]);
    // Only a webhook can go silent; only polling can fail a check.
    for (const c of Object.values(connections)) {
      if (c.tone === 'warn') expect(c.mode).toBe('webhook');
      if (c.tone === 'err') expect(c.mode).toBe('polling');
    }
  });

  it('has terminal scrollback for the runs that need it', () => {
    expect(
      Object.keys(terminalByRun)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([54, 56, 58, 60, 61, 62]);
  });

  it('has twenty-three run details whose status matches the board name', () => {
    const expected = {
      RunStarting: 'starting',
      RunRunning: 'running',
      RunIdle: 'idle',
      RunDone: 'done',
      RunReconnect: 'running',
      RunSucceeded: 'succeeded',
      RunFailed: 'failed',
      RunSetupFailed: 'failed',
      RunTimedOut: 'timed_out',
      RunCancelled: 'cancelled',
      RunPaused: 'paused',
      RunExpired: 'expired',
      RunStopped: 'paused',
      RunSucceededFinished: 'succeeded',
      RunRunningStop: 'running',
      RunIdleEnding: 'idle',
      RunStoppedPodLost: 'paused',
      RunStoppedPodLostGaveUp: 'paused',
      RunStoppedPodLostGaveUpOnce: 'paused',
      RunStoppedCrashedGaveUp: 'paused',
      RunStoppedAutoResumeWaiting: 'paused',
      RunStoppedAutoResumeFailedGaveUp: 'paused',
      RunRunningAutoResume: 'running',
    } as const;
    expect(Object.keys(runDetails).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, status] of Object.entries(expected)) {
      expect(runDetails[k as keyof typeof expected].run.status).toBe(status);
    }
  });

  it('never carries a credential-looking value (FR-3)', () => {
    const text = JSON.stringify({
      agentSettings,
      ignored,
      projects,
      rules,
      runDetails,
      runs,
      skills,
      terminalByRun,
      ticketGroups,
    });
    // `sk-` only as a token start: the prompt template's `agentdesk-status` command is not a key.
    expect(text).not.toMatch(/(?<![\w-])sk-|token=/);
  });

  it('copies board values faithfully', () => {
    expect(runDetails.RunReconnect.elapsed).toBe('9:02');
    expect(runDetails.RunStarting.elapsed).toBe('0:24');
    expect(runDetails.RunIdle.elapsed).toBe('4:51');
    expect(runDetails.RunReconnect.connection).toEqual({ state: 'reconnecting', label: 'Reconnecting, attempt 3' });
    expect(runDetails.RunReconnect.termSize).toBe('116×38');
    expect(runs.find((r) => r.id === 62)?.statusNote).toBe('Waiting 3m. Auto-finish after 30m unattended');
    expect(runs.find((r) => r.id === 56)?.statusNote).toBe('API authentication failed (401)');
    expect(rules.find((r) => r.command === 'code-build')?.stats).toBe('14 runs this week, last 14:15');
    expect(rules.find((r) => r.command === 'qa-e2e')).toMatchObject({
      enabled: false,
      labels: ['needs-qa'],
      stats: 'Turned off 3 Nov',
    });
    expect(ignored[0]).toMatchObject({ at: '14:16', author: 'octo-visitor', reason: 'Author has no write access' });
    expect(ignored[4]).toMatchObject({ command: '/deploy', reason: 'No rule for command' });
    expect(agentSettings.credential).toMatchObject({
      setAt: '12 Oct 2026',
      setBy: 'kim-hale',
      status: { tone: 'err', text: 'Rejected at 11:29' },
    });
    expect(terminalByRun[61][0]).toEqual([
      { text: 'agent-desk runner 0.4.1', tone: 'accent' },
      { text: '  run 61  ·  harbor-labs/invoicer-api', tone: 'dim' },
    ]);
    expect(terminalByRun[56]).toHaveLength(17);
    expect(runDetails.RunSucceeded.pullRequest?.diffstat).toBe('+214 −12');
  });
});

describe('polling copy', () => {
  it('offers 5 min to 30 min, default is the 5 min minimum', () => {
    expect(pollIntervals).toEqual(['5 min', '10 min', '15 min', '30 min']);
    expect(DEFAULT_POLL_INTERVAL).toBe('5 min');
  });

  it('matches the brief and the prototype boards word for word', () => {
    expect(connectionCopy.modeLabel).toBe('How Agent Desk hears about new comments');
    expect(connectionCopy.pollingChecked('5 min', '20s ago')).toBe('Polling every 5 min · last checked 20s ago');
    expect(connectionCopy.pollingCheckedBody('5 min')).toBe(
      'Agent Desk can read comments on this repository. A new command starts a run within 5 minutes.',
    );
    expect(connectionCopy.pollingCheckedBody('30 min')).toMatch(/within 30 minutes\.$/);
    expect(connectionCopy.pollingCostBody).toMatch(/12 an hour at 5 min/);
    expect(connectionCopy.pollingCostBody).toMatch(/5,000 an hour/);
    expect(connections.webhookSilent.text).toBe('No webhooks for 2 days');
    expect(connections.pollingOk.text).toBe('Polling every 5 min');
    expect(connections.pollingRevoked.text).toBe('Polling failed: token revoked');
    expect(connections.pollingRateLimited.text).toBe('Polling failed: rate limited, retry in 5 min');
    expect(connectionCopy.lastEvent('ping, 14:01:37')).toBe('Last event: ping, 14:01:37 (webhook)');
    expect(connectionCopy.lastChecked('20s ago')).toBe('Last checked: 20s ago (polling)');
    expect(connectionCopy.switchToPolling).toBe('Switch to polling');
  });

  it('puts Switch to polling first on the silent-webhook banner only', () => {
    expect(connectionWarnings.webhookSilent.actions.map((a) => a.label)).toEqual([
      'Switch to polling',
      'Check again',
      'Connection details',
    ]);
    expect(connectionWarnings.webhookSilent.actions[0].variant).toBe('primary');
    expect(connectionWarnings.pollingFailed.actions.map((a) => a.label)).not.toContain('Switch to polling');
  });

  it('names the switcher warning after the mode, and none when ok', () => {
    expect(menuWarning(connections.webhookOk)).toBeUndefined();
    expect(menuWarning(connections.pollingOk)).toBeUndefined();
    expect(menuWarning(connections.webhookSilent)).toBe('webhooks');
    expect(menuWarning(connections.pollingRevoked)).toBe('polling');
  });
});

describe('onboarding fixtures', () => {
  it('exports every onboarding fixture', () => {
    expect(orgOptions.length).toBeGreaterThanOrEqual(3);
    expect(orgOptions.some((o) => o.name.length === 60)).toBe(true);
    expect(Object.keys(orgSwitchFixtures).sort()).toEqual(
      [
        'longName',
        'longNameSettings',
        'oneOrg',
        'oneOrgSettings',
        'platformAdmin',
        'platformAdminNoOrg',
        'platformAdminSettings',
        'severalOrgs',
        'severalOrgsSettings',
      ].sort(),
    );
    expect(orgSwitchFixtures.platformAdminNoOrg.current).toBeNull();
    expect(Object.keys(checklistSteps)).toEqual(['none', 'partial', 'complete']);
    expect(checklistSteps.none.every((s) => !s.done)).toBe(true);
    expect(checklistSteps.complete.every((s) => s.done)).toBe(true);
    expect(checklistSteps.none.map((s) => s.label)).toEqual([
      'Connect a code host',
      'Create a project',
      'Add an agent',
      'Add a rule',
    ]);
    expect(pendingInvitationsCount).toBe(2);
    expect(invitationCards.length).toBeGreaterThanOrEqual(3);
    expect(invitationCards.some((c) => c.inviter === null)).toBe(true);
    expect(Object.keys(inviteRoleOptions).sort()).toEqual(['orgAdmin', 'owner', 'projectAdmin']);
    expect(inviteProjectOptions.length).toBeGreaterThan(0);
    expect(invitationLink.startsWith('https://agentdesk.example/invitations/')).toBe(true);
    expect(pagedInvitationRows(7)).toHaveLength(7);
  });

  it('uses valid uuids for every fixture id', () => {
    const ids = [
      ...inviteProjectOptions.map((o) => o.id),
      ...orgOptions.map((o) => o.id),
      ...invitationCards.map((c) => c.id),
      ...orgInvitationRows.map((r) => r.id),
      ...pagedInvitationRows(3).map((r) => r.id),
    ];
    for (const id of ids) expect(z.uuid().safeParse(id).success, id).toBe(true);
  });

  it('has a details fixture per status, expired with the inviter deleted', () => {
    expect(Object.keys(invitationDetails).sort()).toEqual(['accepted', 'declined', 'expired', 'pending', 'revoked']);
    expect(invitationDetails.expired.inviter).toBeNull();
    expect(invitationDetails.pending.expires.text).toMatch(/^\d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/);
    expect(invitationDetails.pending.expires.title).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
  });

  it('covers all five statuses in orgInvitationRows', () => {
    expect(new Set(orgInvitationRows.map((r) => r.status))).toEqual(
      new Set(['pending', 'accepted', 'declined', 'revoked', 'expired']),
    );
  });

  it('offers no Resend or Revoke on resolved rows and Resend only on expired rows (BR-19)', () => {
    for (const r of orgInvitationRows.filter((r) => ['accepted', 'declined', 'revoked'].includes(r.status))) {
      expect(r.actions).not.toContain('resend');
      expect(r.actions).not.toContain('revoke');
      expect(r.expires.kind).toBe('none');
    }
    for (const r of orgInvitationRows.filter((r) => r.status === 'expired')) {
      expect(r.actions).toContain('resend');
      expect(r.actions).not.toContain('revoke');
    }
    for (const r of orgInvitationRows.filter((r) => r.status === 'pending')) {
      expect(r.actions).toEqual(['copy', 'resend', 'revoke']);
    }
  });

  it('shows the exact date directly for an invitation expired long ago (BR-51)', () => {
    expect(orgInvitationRows.some((r) => r.status === 'expired' && r.expires.kind === 'exact')).toBe(true);
    expect(orgInvitationRows.some((r) => r.status === 'expired' && r.expires.kind === 'relative')).toBe(true);
  });
});

describe('tenant-admin fixtures', () => {
  it('lists several owners and a member with no role for the owner caller', () => {
    expect(memberRows.owner.filter((m) => m.role?.key === 'owner').length).toBeGreaterThanOrEqual(2);
    expect(memberRows.owner.some((m) => m.role === null)).toBe(true);
    expect(memberRows.paged).toHaveLength(25);
  });

  it('never lets a caller remove their own row', () => {
    for (const rows of Object.values(memberRows)) {
      for (const r of rows.filter((m) => m.you)) expect(r.canRemove).toBe(false);
    }
  });

  it('marks exactly one row as the caller in each view', () => {
    for (const rows of Object.values(memberRows)) expect(rows.filter((m) => m.you)).toHaveLength(1);
    expect(memberRows.admin.find((m) => m.you)?.handle).toBe('ben');
  });

  it('agrees with the DTO members on role and project roles', () => {
    const projectName: Record<string, string> = {
      [ids.project.invoicerApi]: 'invoicer-api',
      [ids.project.invoicerWeb]: 'invoicer-web',
      [ids.project.docsSite]: 'docs-site',
    };
    for (const dto of tenantMemberFixtures.twoOwners) {
      const view = memberRows.owner.find((m) => m.handle === dto.handle);
      expect(view, dto.handle ?? dto.userId).toBeDefined();
      const org = dto.assignments.find((a) => a.scope.type === 'org');
      expect(view?.role?.key ?? null).toBe(org?.role.key ?? null);
      const projects = dto.assignments.flatMap((a) =>
        a.scope.type === 'project' ? [`${projectName[a.scope.projectId]} (${a.role.name})`] : [],
      );
      expect(view?.projectRoles).toBe(projects.length ? projects.join(', ') : '—');
    }
  });

  it('gives the admin caller no actions on owner rows', () => {
    for (const r of memberRows.admin.filter((m) => m.role?.key === 'owner')) {
      expect([r.canChangeRole, r.canRemove]).toEqual([false, false]);
    }
  });

  it('offers the Owner card to owner callers only', () => {
    expect(roleCards.ownerCaller.map((c) => c.key)).toEqual(['owner', 'admin', 'member', 'viewer', 'none']);
    expect(roleCards.adminCaller.map((c) => c.key)).toEqual(['admin', 'member', 'viewer', 'none']);
  });

  it('orders audit rows newest first', () => {
    const times = auditRows.map((r) => Date.parse(r.when.iso));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(pagedAuditRows(7)).toHaveLength(7);
  });

  it('the paged last page holds the five board entries, newest first', () => {
    expect(pagedAuditLastPage.map((r) => (r.what.kind === 'raw' ? r.what.key : r.what.title))).toEqual([
      'Kim Hale resent the invitation for mira.chen@example.com',
      'Mira Chen accepted an invitation as Member',
      'ari-k declined an invitation',
      'PUT desk.agent.put',
      'Morgan Avery invited kim.hale@harborlabs.dev as Owner',
    ]);
    expect(pagedAuditLastPage[4]!.who).toEqual({ label: 'Morgan Avery', tag: 'platform' });
    const times = pagedAuditLastPage.map((r) => Date.parse(r.when.iso));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('keeps each audit time label and exact date in agreement with its iso', () => {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n: number) => String(n).padStart(2, '0');
    const exactOf = (iso: string) => {
      const d = new Date(iso);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    };
    const now = Date.parse(AUDIT_MOCK_NOW);
    for (const r of [...auditRows, ...pagedAuditRows(5), ...pagedAuditLastPage]) {
      const { label, exact, iso } = r.when;
      expect(exact, label).toBe(exactOf(iso));
      const ago = (now - Date.parse(iso)) / 60_000;
      const rel = /^(\d+) (min|hours?) ago$/.exec(label);
      if (rel) expect(ago).toBe(Number(rel[1]) * (rel[2] === 'min' ? 1 : 60));
      else if (label === 'yesterday') expect(exact.startsWith('21 Nov')).toBe(true);
      else expect(exact.startsWith(label + ' ')).toBe(true);
    }
  });

  it('project space views: members, picker and role cards', () => {
    expect(projectMemberRows[0]).toMatchObject({ name: 'Lee Park', you: true, roles: 'Admin' });
    expect(projectMemberRows.some((r) => r.roles.includes(', '))).toBe(true);
    expect(projectMemberRows.some((r) => r.handle === null)).toBe(true);
    expect(pagedProjectMemberRows).toHaveLength(25);
    expect(memberPickerOptions.some((o) => o.handle === null)).toBe(true);
    expect(manyPickerOptions).toHaveLength(200);
    expect(projectRoleCards.map((c) => c.key)).toEqual(['admin', 'member', 'viewer']);
    expect(projectRoleCards[1]!.description).toBe('See runs, start runs and act on their own runs.');
  });

  it('project audit rows name projects: capped at three, redacted and expired forms', () => {
    const titles = projectAuditRows.map((r) => (r.what.kind === 'sentence' ? r.what.title : r.what.key));
    expect(titles.some((t) => t.endsWith(' to billing-jobs, docs-site, invoicer-api, invoicer-web, storefront'))).toBe(
      true,
    );
    expect(titles).toContain('Lee Park added Mira Chen to this project as Member');
    expect(titles).toContain("Lee Park changed Cleo Martin's project role from Member to Admin");
    expect(titles).toContain('Lee Park removed Dana Wu from this project (was Viewer)');
    expect(projectAuditRows.some((r) => r.what.kind === 'raw')).toBe(true);
    expect(projectAuditRows.some((r) => r.who.tag === 'deleted')).toBe(true);
    const parts = projectAuditRows.flatMap((r) => (r.what.kind === 'sentence' ? r.what.parts.map((x) => x.text) : []));
    expect(parts).toContain('billing-jobs, docs-site, invoicer-api and 2 more');
    const noEmail = projectAuditRowsNoEmail.map((r) => (r.what.kind === 'sentence' ? r.what.title : ''));
    expect(noEmail).toContain('Kim Hale invited someone as Viewer to invoicer-api');
    const expired = projectAuditRowsExpired.map((r) => (r.what.kind === 'sentence' ? r.what.title : ''));
    expect(expired).toEqual([
      'The invitation for sam.reyes@contractor.io to invoicer-api expired',
      'An invitation to invoicer-api expired',
    ]);
    const times = projectAuditRows.map((r) => Date.parse(r.when.iso));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('org audit rows gain project names on invitations, none for the org-scope one', () => {
    const titles = auditRows.map((r) => (r.what.kind === 'sentence' ? r.what.title : r.what.key));
    expect(titles).toContain('Alice Doe invited sam.reyes@contractor.io as Viewer to invoicer-api, invoicer-web');
    expect(titles.some((t) => t.endsWith(' to billing-jobs, docs-site, invoicer-api, invoicer-web, storefront'))).toBe(
      true,
    );
    const parts = auditRows.flatMap((r) => (r.what.kind === 'sentence' ? r.what.parts.map((x) => x.text) : []));
    expect(parts).toContain('billing-jobs, docs-site, invoicer-api and 2 more');
    expect(titles.some((t) => /^The invitation for .* to .* expired$/.test(t))).toBe(true);
    expect(titles.some((t) => /^The invitation for [^ ]+ expired$/.test(t))).toBe(true);
    expect(titles).toContain('An invitation expired');
    expect(titles.some((t) => t.includes('long-invitee') && t.endsWith(' as Member'))).toBe(true);
  });

  it('exposes the org settings tabs per role', () => {
    expect(orgSettingsFixtures.org).toEqual({ name: 'Harbor Labs', slug: 'harbor-labs' });
    expect(orgSettingsFixtures.tabs.projectAdmin).toEqual(['invitations']);
    expect(orgSwitchFixtures.severalOrgsSettings.settingsHref).toBe('/o/acme/settings');
    expect(orgSwitchFixtures.severalOrgs.settingsHref).toBeUndefined();
  });
});
