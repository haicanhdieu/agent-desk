import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import type { TestApp } from './app';

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.ALL]: 'ALL',
};

const joinPath = (...parts: string[]): string =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter((s) => s !== '')
    .join('/');

const first = (v: unknown): string => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : '';
};

export interface Registered {
  method: string;
  url: string;
}

export function registeredRoutes(t: TestApp): Registered[] {
  const discovery = new DiscoveryService(t.app.get(ModulesContainer));
  const out: Registered[] = [];
  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype;
    if (typeof metatype !== 'function') continue;
    const prefix = first(Reflect.getMetadata(PATH_METADATA, metatype));
    const proto = metatype.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const verb: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      if (typeof verb !== 'number') continue;
      const path = first(Reflect.getMetadata(PATH_METADATA, handler));
      out.push({ method: METHOD_NAMES[verb] ?? String(verb), url: joinPath(prefix, path) });
    }
  }
  return out;
}
