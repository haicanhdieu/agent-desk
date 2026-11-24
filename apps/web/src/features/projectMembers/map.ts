import type { ProjectMemberDto } from '@agentdesk/contracts';
import type { ProjectMemberRowView } from '@/mocks/types';

/**
 * One Members row: the project and org role names each joined with ", ", `you` for the signed-in person, a null handle
 * kept null. A person whose access is inherited only (`source` 'org') has no row actions.
 */
export function toProjectMemberRow(dto: ProjectMemberDto, selfUserId: string): ProjectMemberRowView {
  return {
    userId: dto.userId,
    name: dto.name,
    handle: dto.handle,
    you: dto.userId === selfUserId,
    roles: dto.projectRoles.map((r) => r.role.name).join(', '),
    orgRoles: dto.orgRoles.map((r) => r.role.name).join(', '),
    inherited: dto.source === 'org',
  };
}
