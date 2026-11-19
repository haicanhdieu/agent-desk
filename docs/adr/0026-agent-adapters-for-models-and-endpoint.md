# 0026. Agent adapters own the model list, the model and the API address

- Status: Accepted
- Date: 2026-11-19
- Source: issue #122; [agent model routing design](../superpowers/specs/2026-11-19-agent-model-routing-design.md)

## Context

A run always used the Claude Code CLI's own default model and the provider's default API address. A team that fronts
Claude with a gateway, or wants a cheaper model for some tickets, could not say so. Built-in names, credential env
names and the model list are agent-specific, but the code treated "the agent" as Claude everywhere.

## Decision

- An agent adapter per kind lives in `packages/core/src/adapters/agents/` and is looked up with `agentAdapterFor(kind)`.
  It owns the built-in model names, the credential env names, the launch env and the live model list.
- An agent has an optional default model and an optional public `https` API address. A routing rule may name its own
  model. The model is frozen on the run at intake, so a later edit never changes a queued run.
- The API reads the agent credential only to list models, and sends it only to the agent's own address (or the provider
  default) through `guardedGetJson`: https only, no `localhost` or blocked IP ranges, a connect-time check of every
  resolved address (against DNS rebinding), no redirects, a 5 s timeout and a 1 MB body cap. Errors and logs carry
  neither the upstream body nor the credential.
- Changing the address replaces the credential: the same save carries a new one, so a saved credential is never
  forwarded to an address it was not given for.
- The runner passes `--model` to the CLI and prints `agentdesk: agent <kind> model <model> endpoint <origin|default>`.
- `AGENT_MODELS_SOURCE` is `live` (default) or `builtin`; the local stack and local e2e set `builtin`.

## Alternatives considered

| Alternative                                   | Why rejected                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Plain `fetch` to the stored address           | Follows redirects and resolves to private addresses: SSRF with the credential    |
| Let the runner or the browser list the models | The credential would leave the API, or the browser would reach a private address |
| Keep the credential when the address changes  | Forwards a saved credential to an address its owner did not enter it for         |

## Consequences

### Positive

- Gateways and per-rule models work, and the model a run used is recorded on the run.
- The SSRF guard is one shared, tested module.

### Negative

- Adding an agent kind means an adapter, a runner command file and the CLI in the image.
- The outbound call needs the guard and a security review for every change to it.
- A live list depends on the provider; the built-in names are the fallback.

## Links

- [Security conventions](../conventions/security.md) §1, §8
- Related ADRs: [0010](0010-one-kubernetes-job-per-run.md)
