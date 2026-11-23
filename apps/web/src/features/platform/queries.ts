import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { Page, PageQuery, PlatformAdminDto } from '@agentdesk/contracts';
import { api } from '../api';
import { platformKeys } from './keys';

/** One page of the platform admins (`GET /api/platform/admins`). Another page keeps the old rows on screen while it loads. */
export const platformAdminsQuery = (q: PageQuery) =>
  queryOptions({
    queryKey: platformKeys.admins(q),
    queryFn: (): Promise<Page<PlatformAdminDto>> => api.platform.listAdmins({ query: q }),
    placeholderData: keepPreviousData,
  });
