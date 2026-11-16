import { describe, expect, it } from 'vitest';
import { CONNECTION_ID_RE, EXEC_NOT_FOUND, attachCommand, detachCommand } from '../../src/kube/gateway';

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('attach and detach commands', () => {
  it('are fixed argv arrays carrying only the checked id', () => {
    expect(attachCommand(ID)).toEqual(['agentdesk-attach', ID]);
    expect(detachCommand(ID)).toEqual(['agentdesk-detach', ID]);
  });

  it.each(['x; rm -rf /', '', ID.toUpperCase(), `${ID}\n`, `${ID} extra`, '../../etc/passwd'])(
    'refuse the id %j',
    (bad) => {
      expect(() => attachCommand(bad)).toThrow(/connection id/);
      expect(() => detachCommand(bad)).toThrow(/connection id/);
    },
  );

  it('CONNECTION_ID_RE is the runner scripts regex', () => {
    expect(CONNECTION_ID_RE.source).toBe('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  });

  it('EXEC_NOT_FOUND is the shell convention 127', () => {
    expect(EXEC_NOT_FOUND).toBe(127);
  });
});
