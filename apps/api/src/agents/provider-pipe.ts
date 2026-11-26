import type { PipeTransform } from '@nestjs/common';
import { AgentKind } from '@agentdesk/contracts';
import { UnprocessableProblemException } from '../common/zod-validation';

/**
 * Runs before a body's own schema: a `provider` that is not a runnable kind (a Coming-soon name or an unknown one)
 * is 422 on `/provider`, not the generic 400 of an enum miss. A runnable kind passes through to the schema.
 */
export class ProviderPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly next: PipeTransform<unknown, T>) {}
  transform(value: unknown): T {
    if (
      typeof value === 'object' &&
      value !== null &&
      'provider' in value &&
      !AgentKind.safeParse(value.provider).success
    ) {
      throw new UnprocessableProblemException('This provider cannot be used', [
        { pointer: '/provider', detail: 'This provider is not available yet' },
      ]);
    }
    return this.next.transform(value, { type: 'body' });
  }
}
