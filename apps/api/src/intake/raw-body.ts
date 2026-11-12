import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Exact bytes of a webhook request body, kept so the adapter can verify the provider's signature over them. */
    rawWebhookBody?: Buffer;
  }
}

export const WEBHOOK_PATH_PREFIX = '/webhooks/';
/** Same as Fastify's default body limit. */
export const WEBHOOK_BODY_LIMIT = 1_048_576;

class PayloadTooLarge extends Error {
  readonly statusCode = 413;
  constructor() {
    super('Request body too large');
  }
}

/**
 * Keeps the raw bytes of `/webhooks/*` request bodies. A `preParsing` hook limited to that path prefix (rather than
 * replacing the JSON content type parser) leaves parsing for every other route untouched: the bytes are collected,
 * stored on the request, and handed on unchanged for the normal parser.
 */
export function captureWebhookRawBody(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (req, _reply, payload) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith(WEBHOOK_PATH_PREFIX)) return payload;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > WEBHOOK_BODY_LIMIT) throw new PayloadTooLarge();
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks);
    req.rawWebhookBody = raw;
    return Readable.from([raw], { objectMode: false });
  });
}
