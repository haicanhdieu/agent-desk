import { randomUUID } from 'node:crypto';
import type { TicketEvent } from '../../src/adapters/types';

/**
 * A trigger comment written by the desk's own bot on the same ticket as `base`, made at `createdAt`. It carries fresh
 * delivery and comment ids, so it is a new comment, and the association NONE a bot account has on a board.
 * The origin run is found by the desk from the comment's time, not from anything in the event.
 */
export function botTriggerEvent(base: TicketEvent, createdAt: string, botLogin = 'agentdesk[bot]'): TicketEvent {
  const id = randomUUID();
  return {
    ...base,
    deliveryId: `d-${id}`,
    commentId: `c-${id}`,
    author: botLogin,
    authorId: botLogin,
    authorAssociation: 'NONE',
    createdAt,
  };
}
