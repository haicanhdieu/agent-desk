import { ConflictException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ORG_HEADER, ORG_MISMATCH_PROBLEM_TYPE, ORG_QUERY_PARAM } from '@agentdesk/contracts';

/** The request names an organization that is not the session's active one: a 409 problem of type `org-mismatch`. */
export class OrgMismatchException extends ConflictException {
  readonly problemType = ORG_MISMATCH_PROBLEM_TYPE;
  constructor() {
    super('The organization in the request is not the active organization');
  }
}

const NonEmptyString = z.string().min(1);
const StringOrList = z.union([NonEmptyString, z.array(z.unknown())]);
const QueryShape = z.object({ [ORG_QUERY_PARAM]: z.unknown() }).passthrough();

/** The first non-empty string of a value that may be a string or an array of values; anything else is undefined. */
function firstString(value: unknown): string | undefined {
  const parsed = StringOrList.safeParse(value);
  if (!parsed.success) return undefined;
  if (typeof parsed.data === 'string') return parsed.data;
  return parsed.data.find((v): v is string => NonEmptyString.safeParse(v).success);
}

/** The org a request names: the x-org-id header, else the orgId query param; '' and non-strings are undefined. */
export function requestedOrgId(req: FastifyRequest): string | undefined {
  const fromHeader = firstString(req.headers[ORG_HEADER]);
  if (fromHeader !== undefined) return fromHeader;
  const query = QueryShape.safeParse(req.query);
  return query.success ? firstString(query.data[ORG_QUERY_PARAM]) : undefined;
}
