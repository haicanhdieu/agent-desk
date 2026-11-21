import { Inject, Injectable } from '@nestjs/common';
import type { OrgChecklistDto } from '@agentdesk/contracts';
import { orgChecklist } from '@agentdesk/core';
import { withOrg, type Db } from '@agentdesk/db';
import { DB } from '../db/db.module';

@Injectable()
export class ChecklistService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The route's guard admits only holders of `project:create` at org scope (owner, org admin) and 404s another
   * org's id. Those holders see every project, and RLS scopes projects to the org, so no id list is passed.
   */
  checklist(orgId: string): Promise<OrgChecklistDto> {
    return withOrg(this.db, orgId, (tx) => orgChecklist(tx));
  }
}
