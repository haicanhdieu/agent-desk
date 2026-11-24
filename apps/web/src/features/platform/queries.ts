import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type {
  Page,
  PageQuery,
  PlatformAdminDto,
  PlatformAuditEntryDto,
  PlatformAuditListQuery,
  PlatformOrgDetailDto,
  PlatformOrgDto,
  PlatformOrgListQuery,
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
