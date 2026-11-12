import { ApiError } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { fieldErrorsFromProblem } from './problem';

const MAP = { '/command': 'command', '/labelFilter': 'labels' };

const conflict = (errors: { pointer: string; detail: string }[], detail?: string) =>
  new ApiError({
    status: 409,
    type: 'conflict',
    title: 'Rule already exists',
    errors,
    ...(detail && { detail }),
  });

describe('fieldErrorsFromProblem', () => {
  it('maps the /command pointer to the command field', () => {
    const e = conflict([
      {
        pointer: '/command',
        detail: 'A rule for /code-build already exists in this project.',
      },
    ]);
    expect(fieldErrorsFromProblem(e, MAP)).toEqual({
      fields: {
        command: 'A rule for /code-build already exists in this project.',
      },
    });
  });

  it('maps nested pointers by their first segment (/labelFilter/0 → labels)', () => {
    const e = conflict([{ pointer: '/labelFilter/0', detail: 'Too long.' }]);
    expect(fieldErrorsFromProblem(e, MAP)).toEqual({
      fields: { labels: 'Too long.' },
    });
  });

  it('an unknown pointer becomes the form message, with the problem detail first', () => {
    const e = conflict([{ pointer: '/agentId', detail: 'Agent is gone.' }], 'The rule was not saved.');
    expect(fieldErrorsFromProblem(e, MAP)).toEqual({
      fields: {},
      form: 'The rule was not saved. Agent is gone.',
    });
  });

  it('mapped and unknown pointers together: the field keeps its message, the rest goes to the form', () => {
    const e = conflict([
      { pointer: '/command', detail: 'Taken.' },
      { pointer: '/nope', detail: 'Odd.' },
    ]);
    expect(fieldErrorsFromProblem(e, MAP)).toEqual({
      fields: { command: 'Taken.' },
      form: 'Rule already exists Odd.',
    });
  });

  it('an ApiError without errors[] is a form message from its title', () => {
    const e = new ApiError({
      status: 500,
      type: 'internal',
      title: 'Internal server error',
    });
    expect(fieldErrorsFromProblem(e, MAP)).toEqual({
      fields: {},
      form: 'Internal server error',
    });
  });

  it('a plain Error is a generic form message', () => {
    expect(fieldErrorsFromProblem(new Error('boom'), MAP)).toEqual({
      fields: {},
      form: 'Something went wrong. Try again.',
    });
  });

  it('the first message per field wins', () => {
    const e = conflict([
      { pointer: '/command', detail: 'First.' },
      { pointer: '/command', detail: 'Second.' },
    ]);
    expect(fieldErrorsFromProblem(e, MAP).fields).toEqual({
      command: 'First.',
    });
  });
});
