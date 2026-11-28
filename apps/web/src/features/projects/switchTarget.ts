import type { Access } from '@agentdesk/contracts';
import type { MenuItemKey } from '../chrome/routeChrome';
import { deskRightsOf, projectPaths, type DeskRights } from '../desk/frame';

/** The project pages the switcher can keep: the menu item that marks each, with the right that opens it on the target. */
const KEPT: Partial<
  Record<MenuItemKey, { right: keyof DeskRights | undefined; path: keyof ReturnType<typeof projectPaths> }>
> = {
  runs: { right: undefined, path: 'runs' },
  rules: { right: 'rules', path: 'rules' },
  skills: { right: 'skills', path: 'skills' },
  setup: { right: 'setup', path: 'setup' },
  agent: { right: 'agent', path: 'agent' },
  projectMembers: { right: 'members', path: 'members' },
  projectAudit: { right: 'audit', path: 'audit' },
};

/**
 * Where picking project `targetId` in the switcher goes: the same page of that project when the person may open it
 * there, else its Runs page (BR-51); from a run page always Runs (BR-52). Never carries a search (no `tab`, `agent`
 * or `page`), so Agent & settings opens on "Agents" with no pane.
 */
export function switchTargetHref(
  org: string,
  targetId: string,
  item: MenuItemKey | undefined,
  parent: boolean,
  access: Access | undefined,
): string {
  const paths = projectPaths(org, targetId);
  const kept = parent || item === undefined ? undefined : KEPT[item];
  if (kept === undefined) return paths.runs;
  if (kept.right !== undefined && !deskRightsOf(access, targetId)[kept.right]) return paths.runs;
  return paths[kept.path];
}
