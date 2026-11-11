import type { TermLine } from './Terminal';

const t = (text: string, tone?: TermLine[number]['tone']) => ({ text, tone });

export const transcript: TermLine[] = [
  [t('agent-desk runner 0.4.1', 'accent'), t('  run 61  ·  harbor-labs/invoicer-api', 'dim')],
  [t('clone ', 'dim'), t('main @ a91c3e2'), t(' … done in 6.2s', 'dim')],
  [],
  [t('> ', 'dim'), t('Run the code-build skill for issue #139 in harbor-labs/invoicer-api.')],
  [],
  [t('● ', 'dotw'), t("I'll read the skill and the issue first.")],
  [],
  [t('● ', 'dot'), t('Read', 'bold'), t('(', 'dim'), t('.claude/skills/code-build/SKILL.md'), t(')', 'dim')],
  [t('  ⎿  ', 'dim'), t('Read 41 lines', 'dim')],
  [],
  [t('● ', 'dot'), t('Update', 'bold'), t('(', 'dim'), t('src/Invoicer.Api/Program.cs'), t(')', 'dim')],
  [t('  ⎿  ', 'dim'), t('Updated src/Invoicer.Api/Program.cs with 2 additions and 1 removal', 'dim')],
  [t('       38 ', 'dim'), t('builder.Services.AddProblemDetails();')],
  [t('       39 ', 'dim'), t('+ builder.Services.AddRateLimiter(o => o.RejectionStatusCode = 429);', 'add')],
  [t('       40 ', 'dim'), t('- app.UseAuthentication();', 'del')],
  [],
  [t('● ', 'dot'), t('Bash', 'bold'), t('(', 'dim'), t('dotnet test'), t(')', 'dim')],
  [t('  ⎿  ', 'dim'), t('Passed!', 'green'), t('  - Failed: 0, Passed: 132', 'dim'), t('  Failed: 1', 'red')],
];

export const shortScrollback: TermLine[] = [
  [t('agent-desk runner 0.4.1', 'accent'), t('  run 57  ·  harbor-labs/invoicer-api', 'dim')],
  [t('start ', 'dim'), t("claude in tmux session 'agent'")],
  [t('error ', 'red'), t('process exited with code 1', 'dim')],
];
