import type { TranscriptItem } from '@/components/Transcript';

const msg = (
  key: string,
  kind: 'user' | 'agent',
  label: string,
  time: string,
  text: string,
  truncated = false,
): TranscriptItem => ({ key, kind, label, time, text, truncated });
const tool = (key: string, name: string, text: string, time = '14:12'): TranscriptItem => ({
  key,
  kind: 'tool',
  tool: name,
  time,
  text,
  truncated: false,
});
const notice = (key: string, text: string, time = '14:16'): TranscriptItem => ({
  key,
  kind: 'notice',
  time,
  text,
  truncated: false,
});

const decision = `Review is posted and tests pass. One decision needs you before I approve:

Issue #142 asks for a CSV that "opens cleanly in Excel". The exporter writes UTF-8 without a byte order mark, so Excel on Windows garbles accented customer names.

1. Write a BOM. Excel opens it cleanly; a few CSV parsers must strip it.
2. Keep plain UTF-8 and add a note in the export dialog.

Reply with 1 or 2, or tell me something else. I will not approve until you answer.`;

const toolSteps: TranscriptItem[] = [
  tool('t1', 'Bash', 'dotnet test'),
  tool('t2', 'Bash', 'gh pr review 148 --comment --body-file /tmp/review.md'),
  tool('t3', 'Edit', 'src/Invoicer.Api/Exports/CsvInvoiceExporter.cs', '14:17'),
  tool('t4', 'Write', 'tests/Invoicer.Api.Tests/CsvInvoiceExporterTests.cs', '14:17'),
];

const notices: TranscriptItem[] = [
  notice('n1', 'Conversation compacted'),
  msg('a1', 'agent', 'Claude', '14:19', 'Continuing after the compaction.'),
  notice('n2', 'Transcript limit reached; later messages were not saved', '14:30'),
];

const truncated: TranscriptItem[] = [
  msg(
    'a1',
    'agent',
    'Claude',
    '14:19',
    'The exporter now writes a UTF-8 BOM and the new test checks the first three bytes (EF BB BF). All 133 tests pass. Here is the full diff of the change, with the reasoning for each hunk:\n\n--- a/src/Invoicer.Api/Exports/CsvInvoiceExporter.cs\n+++ b/src/Invoicer.Api/Exports/CsvInvoiceExporter.cs\n-    using var writer = new StreamWriter(stream, new UTF8Encoding(false));\n+    using var writer = new StreamWriter(stream, new UTF8Encoding(true));',
    true,
  ),
];

const defaultItems: TranscriptItem[] = [
  msg('u0', 'user', 'Prompt', '14:01', 'Review PR #148 and approve it when the exporter handles accented names.'),
  tool('t1', 'Bash', 'dotnet test'),
  tool('t2', 'Bash', 'gh pr review 148 --comment --body-file /tmp/review.md'),
  msg('a1', 'agent', 'Claude', '14:13', decision),
  msg('u1', 'user', 'You', '14:16', '1. Write the BOM, and add a test that checks the first three bytes of the file.'),
  notice('n1', 'Conversation compacted'),
  tool('t3', 'Edit', 'src/Invoicer.Api/Exports/CsvInvoiceExporter.cs', '14:17'),
  tool('t4', 'Bash', 'dotnet test --filter CsvInvoiceExporter', '14:18'),
  ...truncated,
];

const markdownReply = [
  '## Review summary',
  '',
  'The exporter now writes a **UTF-8 BOM**; see [the PR](https://example.com/pr/148) and `CsvInvoiceExporter`.',
  '',
  '- Excel opens the file cleanly',
  '- Parsers that dislike a BOM must strip it',
  '',
  '| Check | Result |',
  '| ----- | ------ |',
  '| dotnet test | 133 passed |',
  '| BOM bytes | EF BB BF |',
  '',
  '```csharp',
  'using var writer = new StreamWriter(stream, new UTF8Encoding(true));',
  '```',
].join('\n');

const markdown: TranscriptItem[] = [
  msg('m0', 'user', 'Prompt', '14:01', 'Write the BOM and **list the checks** you ran.'),
  msg('m1', 'agent', 'Claude', '14:13', markdownReply),
  msg('m2', 'agent', 'Claude', '14:14', '<script>alert(1)</script> Unsafe raw HTML is not rendered or run.'),
];

const long: TranscriptItem[] = [
  ...Array.from({ length: 12 }, (_, i): TranscriptItem[] => [
    msg(`l${i}u`, 'user', 'You', '13:4' + (i % 10), `Question ${i + 1}: what does the exporter do with empty rows?`),
    msg(`l${i}a`, 'agent', 'Claude', '13:4' + (i % 10), `Answer ${i + 1}: it skips them and keeps the header.`),
  ]).flat(),
  ...defaultItems,
];

export const transcriptFixtures: {
  default: TranscriptItem[];
  long: TranscriptItem[];
  truncated: TranscriptItem[];
  toolSteps: TranscriptItem[];
  notices: TranscriptItem[];
  markdown: TranscriptItem[];
} = { default: defaultItems, long, truncated, toolSteps, notices, markdown };

const row = (key: string, kind: TranscriptItem['kind'], over: Partial<TranscriptItem>): TranscriptItem => ({
  key,
  kind,
  time: '',
  text: '',
  truncated: false,
  ...over,
});

/** The short transcripts of the "transcript in the other stopped and ended states" board (RunTranscriptStates). */
export const transcriptStateFixtures: Record<
  'pausedIdleTimer' | 'failed' | 'timedOut' | 'cancelled' | 'expired',
  TranscriptItem[]
> = {
  pausedIdleTimer: [
    row('p1', 'tool', { tool: 'Bash', text: 'dotnet test', time: '15:01' }),
    row('p2', 'agent', {
      label: 'Claude',
      time: '15:02',
      text: 'Tests pass. Should I also add the export button to the mobile layout?',
    }),
  ],
  failed: [
    row('f1', 'user', {
      label: 'Prompt',
      time: '11:20',
      text: 'Run the code-review skill for PR #133 in harbor-labs/invoicer-api. Arguments: (none)',
    }),
    row('f2', 'agent', { label: 'Claude', time: '11:20', text: 'API Error: 401 invalid credential' }),
  ],
  timedOut: [row('t1', 'tool', { tool: 'Bash', text: 'pnpm e2e --grep pdf --repeat-each 5', time: '13:41' })],
  cancelled: [row('c1', 'tool', { tool: 'Edit', text: 'src/Invoicer.Api/Webhooks/StripeWebhook.cs', time: '13:08' })],
  expired: [
    row('e1', 'agent', {
      label: 'Claude',
      time: '09:12',
      text: 'Which currency should the totals row use when invoices mix EUR and USD?',
    }),
    row('e2', 'notice', { text: 'Transcript limit reached; later messages were not saved' }),
  ],
};
