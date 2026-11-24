/** Request header naming the org (its id, not its slug) a request is pinned to. */
export const ORG_HEADER = 'x-org-id';
/** Query param carrying the same org id on SSE and terminal URLs, which cannot set headers. */
export const ORG_QUERY_PARAM = 'orgId';
/** Problem `type` of the 409 answered when the pinned org is not the session's active org. */
export const ORG_MISMATCH_PROBLEM_TYPE = 'org-mismatch';
/** WebSocket close code for a terminal whose org no longer matches the session's active org. */
export const TERMINAL_CLOSE_ORG_CHANGED = 4412;
/** Code of the sign-in error for an account with no invitation. */
export const NO_INVITATION_CODE = 'no_invitation';
/** Problem `type` of the 403 answered when the caller's org is suspended. */
export const ORG_SUSPENDED_PROBLEM_TYPE = 'org-suspended';
/** Longest reason a platform admin may give when suspending or reactivating an org. */
export const ORG_STATUS_REASON_MAX = 500;
