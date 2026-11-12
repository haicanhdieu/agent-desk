import { z } from 'zod';
import { Provider } from '../enums';
import { Id, Timestamp } from './common';

export const ConnectionDto = z.object({
  id: Id,
  provider: Provider,
  capabilities: z.object({ code: z.boolean(), board: z.boolean() }),
  accountName: z.string(),
  status: z.enum(['active', 'suspended', 'revoked']),
  createdAt: Timestamp,
});
export type ConnectionDto = z.infer<typeof ConnectionDto>;

export const InstallResponse = z.object({ url: z.string() });
export type InstallResponse = z.infer<typeof InstallResponse>;

export const RepoDto = z.object({
  repoPath: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
});
export type RepoDto = z.infer<typeof RepoDto>;
