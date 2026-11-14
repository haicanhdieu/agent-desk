import { describe, expect, it } from 'vitest';
import { findMisnamed } from './check-test-split';

const DB = "import { startPg } from '@agentdesk/db/testing';\nexport const x = startPg;\n";

describe('findMisnamed', () => {
  it('flags a unit-named test that reaches the db testing module through a helper', () => {
    const files = {
      'pkg/test/a.test.ts': "import { app } from './helpers/app';\n",
      'pkg/test/helpers/app.ts': "import { startPg } from '@agentdesk/db/testing';\n",
    };
    expect(findMisnamed(files)).toEqual(['pkg/test/a.test.ts']);
  });

  it('accepts an int-named test that reaches the db testing module', () => {
    const files = { 'pkg/test/a.int.test.ts': DB };
    expect(findMisnamed(files)).toEqual([]);
  });

  it('flags an int-named test that never reaches Docker', () => {
    const files = {
      'pkg/test/a.int.test.ts': "import { x } from './pure';\n",
      'pkg/test/pure.ts': 'export const x = 1;\n',
    };
    expect(findMisnamed(files)).toEqual(['pkg/test/a.int.test.ts']);
  });

  it('ignores tests that only import pure modules', () => {
    const files = {
      'pkg/test/a.test.ts': "import { x } from './pure';\n",
      'pkg/test/pure.ts': 'export const x = 1;\n',
    };
    expect(findMisnamed(files)).toEqual([]);
  });

  it('follows index files and survives import cycles', () => {
    const files = {
      'pkg/test/a.test.ts': "import './h';\n",
      'pkg/test/h/index.ts': "import '../h2';\n",
      'pkg/test/h2.ts': "import './h';\nimport '@agentdesk/db/testing';\n",
    };
    expect(findMisnamed(files)).toEqual(['pkg/test/a.test.ts']);
  });

  it('treats the db package testing source file as the Docker module', () => {
    const files = {
      'packages/db/test/a.test.ts': "import { pg } from './helpers/pg';\n",
      'packages/db/test/helpers/pg.ts': "import { startPg } from '../../src/testing';\n",
      'packages/db/src/testing.ts': "import { PostgreSqlContainer } from '@testcontainers/postgresql';\n",
    };
    expect(findMisnamed(files)).toEqual(['packages/db/test/a.test.ts']);
  });
});
