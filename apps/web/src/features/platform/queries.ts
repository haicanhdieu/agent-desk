import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type {
  Page,
  PageQuery,
  PlatformAdminDto,
  PlatformAuditEntryDto,
  PlatformAuditListQuery,
  PlatformMemberDto,
  PlatformOrgDetailDto,
  PlatformOrgDto,
  PlatformOrgListQuery,
  PlatformProjectDto,
  PlatformRoleDto,
} from '@agentdesk/contracts';
import { api } from '../api';
import { platformKeys } from './keys';

/** One page of the platform admins (`GET /api/platform/admins`). Another page keeps the old rows on screen while it loads. */
export const platformAdminsQuery = (q: PageQuery) =>
  queryOptions({
    queryKey: platformKeys.admins(q),
    queryFn: (): Promise<Page<PlatformAdminDto>> => api.platform.listAdmins({ query: q }),
    placeholderData: keepPreviousData,
  });

/** One page of the Organizations directory (`GET /api/platform/orgs`), newest first. A new page or filter keeps the old rows while it loads. */
export const platformOrgsQuery = (q: PlatformOrgListQuery) =>
  queryOptions({
    queryKey: platformKeys.orgs(q),
    queryFn: (): Promise<Page<PlatformOrgDto>> => api.platform.listOrgs({ query: q }),
    placeholderData: keepPreviousData,
  });

/** One organization (`GET /api/platform/orgs/:orgId`): the detail page and its side menu share it. */
export const platformOrgQuery = (orgId: string) =>
  queryOptions({
    queryKey: platformKeys.org(orgId),
    queryFn: (): Promise<PlatformOrgDetailDto> => api.platform.getOrg({ params: { orgId } }),
  });

/** One page of the platform audit log (`GET /api/platform/audit`), newest first. A new page or filter keeps the old rows while it loads. */
export const platformAuditQuery = (q: PlatformAuditListQuery) =>
  queryOptions({
    queryKey: platformKeys.audit(q),
    queryFn: (): Promise<Page<PlatformAuditEntryDto>> => api.platform.listAudit({ query: q }),
    placeholderData: keepPreviousData,
  });

/** One page of an org's projects (`GET /api/platform/orgs/:orgId/projects`): id and name only. A new page keeps the old rows while it loads. */
export const platformOrgProjectsQuery = (orgId: string, q: PageQuery) =>
  queryOptions({
    queryKey: platformKeys.orgList(orgId, 'projects', q),
    queryFn: (): Promise<Page<PlatformProjectDto>> => api.platform.listProjects({ params: { orgId }, query: q }),
    placeholderData: keepPreviousData,
  });

/** One page of an org's members with their assignments (`GET /api/platform/orgs/:orgId/members`). A new page keeps the old rows while it loads. */
export const platformOrgMembersQuery = (orgId: string, q: PageQuery) =>
  queryOptions({
    queryKey: platformKeys.orgList(orgId, 'members', q),
    queryFn: (): Promise<Page<PlatformMemberDto>> => api.platform.listMembers({ params: { orgId }, query: q }),
    placeholderData: keepPreviousData,
  });

/** The roles an assignment can use in one org (`GET /api/platform/orgs/:orgId/roles`). */
export const platformOrgRolesQuery = (orgId: string) =>
  queryOptions({
    queryKey: platformKeys.orgRoles(orgId),
    queryFn: (): Promise<PlatformRoleDto[]> => api.platform.listRoles({ params: { orgId } }),
  });

/** The API pages lists at 100. */
const PROJECTS_PAGE_SIZE = 100;
/** A stop for the page loop if the API's `total` never gets reached. */
const PROJECTS_MAX_PAGES = 50;

/**
 * Every project of an org (id and name), read page by page until `total` is reached, for the names in role labels and
 * the project choice. One query per org, under `['platform', 'orgs', orgId, …]` so the org invalidations reach it.
 */
export const platformOrgAllProjectsQuery = (orgId: string) =>
  queryOptions({
    queryKey: platformKeys.orgList(orgId, 'projects', { all: true }),
    queryFn: async (): Promise<PlatformProjectDto[]> => {
      const items: PlatformProjectDto[] = [];
      for (let page = 1; page <= PROJECTS_MAX_PAGES; page++) {
        const res = await api.platform.listProjects({
          params: { orgId },
          query: { page, pageSize: PROJECTS_PAGE_SIZE },
        });
        items.push(...res.items);
        if (res.items.length === 0 || items.length >= res.total) break;
      }
      return items;
    },
  });
