import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { routes, type AuditEntryDto, type Page, type PageQuery } from '@agentdesk/contracts';
import { routePath } from '../common/route-path';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { ZodPipe } from '../common/zod-validation';
import { AuditService } from './audit.service';

const ListParams = new ZodPipe(routes.audit.list.params);
const ListQuery = new ZodPipe(routes.audit.list.query);
const ProjectParams = new ZodPipe(routes.projects.audit.params);
const ProjectQuery = new ZodPipe(routes.projects.audit.query);

/** `/api/orgs/:orgId/audit`: org-level `audit:read`, decided by the guard before any lookup; the tenant is the session's org. */
@Controller()
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get(routePath(routes.audit.list))
  list(
    @Param(ListParams) p: { orgId: string },
    @Query(ListQuery) q: PageQuery,
    @CurrentAccess() authz: RequestAuthz,
  ): Promise<Page<AuditEntryDto>> {
    return this.audit.list(authz.access, p.orgId, q);
  }

  /** `/api/projects/:projectId/audit`: project-level `project-audit:read` and project scope are decided by the guard. */
  @Get(routePath(routes.projects.audit))
  listProject(
    @CurrentOrg() org: OrgContext,
    @Param(ProjectParams) p: { projectId: string },
    @Query(ProjectQuery) q: PageQuery,
    @CurrentAccess() authz: RequestAuthz,
  ): Promise<Page<AuditEntryDto>> {
    return this.audit.listProject(authz.access, org.orgId, p.projectId, q);
  }
}
