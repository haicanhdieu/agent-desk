import { describe, expect, it } from 'vitest';
import { readTestPgConfig } from '../src/test-pg-config';

describe('readTestPgConfig', () => {
  it('defaults to Testcontainers when nothing is set', () => {
    expect(readTestPgConfig({})).toEqual({ mode: 'testcontainers' });
  });

  it('treats an empty TEST_PG_MODE as unset', () => {
    expect(readTestPgConfig({ TEST_PG_MODE: '' })).toEqual({ mode: 'testcontainers' });
  });

  it('ignores the local-only variables in Testcontainers mode', () => {
    expect(readTestPgConfig({ TEST_PG_MODE: 'testcontainers', TEST_PG_BIN_DIR: '/opt/pg/bin' })).toEqual({
      mode: 'testcontainers',
    });
  });

  it('reads local mode with a binary and data directory', () => {
    expect(
      readTestPgConfig({ TEST_PG_MODE: 'local', TEST_PG_BIN_DIR: '/opt/pg/bin', TEST_PG_DATA_ROOT: '/tmp/pgdata' }),
    ).toEqual({ mode: 'local', binDir: '/opt/pg/bin', dataRoot: '/tmp/pgdata' });
  });

  it('leaves the directories undefined in local mode when unset or empty', () => {
    expect(readTestPgConfig({ TEST_PG_MODE: 'local', TEST_PG_BIN_DIR: '' })).toEqual({
      mode: 'local',
      binDir: undefined,
      dataRoot: undefined,
    });
  });

  it('rejects an unknown mode and names the allowed values', () => {
    expect(() => readTestPgConfig({ TEST_PG_MODE: 'docker' })).toThrow(/TEST_PG_MODE.*testcontainers.*local/);
  });

  it('rejects relative directories', () => {
    expect(() => readTestPgConfig({ TEST_PG_MODE: 'local', TEST_PG_BIN_DIR: 'pg/bin' })).toThrow(/TEST_PG_BIN_DIR/);
    expect(() => readTestPgConfig({ TEST_PG_MODE: 'local', TEST_PG_DATA_ROOT: './data' })).toThrow(/TEST_PG_DATA_ROOT/);
  });
});
