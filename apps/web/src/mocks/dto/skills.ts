import type { SkillDto } from '@agentdesk/contracts';
import { skills } from '../skills';
import { ids } from './ids';

// Same skills and bodies as mocks/skills.ts (DeskSkills). The board's "a91c3e2, 2 days ago" is the last commit.
const lastCommit = { sha: 'a91c3e2', message: 'Add agent skills', at: '2026-11-10T14:00:00.000Z' };

export const skillFixtures: Record<string, SkillDto[]> = {
  [ids.project.invoicerApi]: skills.map((s) => ({
    name: s.name,
    description: s.description,
    path: s.path,
    lastCommit,
    body: s.body,
    sha: `${lastCommit.sha}-${s.name}`,
  })),
};
