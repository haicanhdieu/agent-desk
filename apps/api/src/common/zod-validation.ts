import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export interface ValidationIssue {
  pointer: string;
  detail: string;
}

/** Carries RFC 9457 `errors[]` entries; the problem filter renders it as a 400. */
export class ValidationProblemException extends BadRequestException {
  constructor(readonly issues: ValidationIssue[]) {
    super('Request validation failed');
  }
}

export function toIssues(error: z.core.$ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    pointer:
      i.path.length === 0 ? '' : `/${i.path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`,
    detail: i.message,
  }));
}

/** Validates a body/query/param against an explicit contracts schema (no reliance on emitted type metadata). */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new ValidationProblemException(toIssues(result.error));
    return result.data;
  }
}
