import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { Page, PageQuery, PlatformAdminDto, PlatformOrgDto, PlatformOrgListQuery } from '@agentdesk/contracts';
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
