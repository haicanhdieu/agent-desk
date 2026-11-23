import { ForbiddenException } from '@nestjs/common';
import { ORG_SUSPENDED_PROBLEM_TYPE } from '@agentdesk/contracts';

/** Fixed text of the refusal: it never carries the reason, the date or any other org data. */
export const ORG_SUSPENDED_DETAIL = 'This organization is suspended.';

/** A member of a suspended org is refused: a 403 problem of type `org-suspended`, the same for every role. */
export class OrgSuspendedException extends ForbiddenException {
  readonly problemType = ORG_SUSPENDED_PROBLEM_TYPE;
  constructor() {
    super(ORG_SUSPENDED_DETAIL);
  }
}
