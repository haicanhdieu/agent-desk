import { z } from 'zod';

export const Timestamp = z.iso.datetime({ offset: true });
export const Id = z.uuid();
export const SlugName = z.string().regex(/^[a-z0-9-]+$/);
