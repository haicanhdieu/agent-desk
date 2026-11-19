import { guardedGetJson, type AgentHttpGet } from '@agentdesk/core';

/** Injection token for the HTTP GET the model list uses; tests replace it so nothing touches the network. */
export const AGENT_HTTP = Symbol('AGENT_HTTP');

export const agentHttpProvider = {
  provide: AGENT_HTTP,
  useValue: ((url, headers, opts) => guardedGetJson(url, { headers, ...opts })) satisfies AgentHttpGet,
};
