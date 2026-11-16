import { describe, expect, it } from 'vitest';
import { localServerOptions, timeSkippingServerOptions } from './helpers/temporal-env';

describe('temporal test server options', () => {
  it('lets the SDK download its default servers when nothing is set', () => {
    expect(localServerOptions({})).toEqual({});
    expect(timeSkippingServerOptions({})).toEqual({});
  });

  it('treats empty values as unset', () => {
    expect(localServerOptions({ TEMPORAL_CLI_PATH: '' })).toEqual({});
    expect(timeSkippingServerOptions({ TEMPORAL_TEST_SERVER_PATH: '' })).toEqual({});
  });

  it('runs the dev server from TEMPORAL_CLI_PATH', () => {
    expect(localServerOptions({ TEMPORAL_CLI_PATH: '/home/r/.local/bin/temporal' })).toEqual({
      server: { executable: { type: 'existing-path', path: '/home/r/.local/bin/temporal' } },
    });
  });

  it('runs the time-skipping server from TEMPORAL_TEST_SERVER_PATH', () => {
    expect(timeSkippingServerOptions({ TEMPORAL_TEST_SERVER_PATH: '/opt/t/temporal-test-server' })).toEqual({
      server: { executable: { type: 'existing-path', path: '/opt/t/temporal-test-server' } },
    });
  });

  it('does not mix the two binaries up', () => {
    expect(localServerOptions({ TEMPORAL_TEST_SERVER_PATH: '/opt/t/temporal-test-server' })).toEqual({});
    expect(timeSkippingServerOptions({ TEMPORAL_CLI_PATH: '/opt/t/temporal' })).toEqual({});
  });

  it('rejects relative paths', () => {
    expect(() => localServerOptions({ TEMPORAL_CLI_PATH: 'bin/temporal' })).toThrow(/TEMPORAL_CLI_PATH/);
    expect(() => timeSkippingServerOptions({ TEMPORAL_TEST_SERVER_PATH: './tts' })).toThrow(
      /TEMPORAL_TEST_SERVER_PATH/,
    );
  });
});
