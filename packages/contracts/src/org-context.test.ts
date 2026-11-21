import { describe, expect, it } from 'vitest';
import {
  NO_INVITATION_CODE,
  ORG_HEADER,
  ORG_MISMATCH_PROBLEM_TYPE,
  ORG_QUERY_PARAM,
  TERMINAL_CLOSE_ORG_CHANGED,
} from './org-context';

describe('org context constants', () => {
  it('has the agreed values', () => {
    expect(ORG_HEADER).toBe('x-org-id');
    expect(ORG_QUERY_PARAM).toBe('orgId');
    expect(ORG_MISMATCH_PROBLEM_TYPE).toBe('org-mismatch');
    expect(TERMINAL_CLOSE_ORG_CHANGED).toBe(4412);
    expect(NO_INVITATION_CODE).toBe('no_invitation');
  });
});
