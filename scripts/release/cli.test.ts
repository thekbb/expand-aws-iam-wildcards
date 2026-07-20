import { describe, expect, it } from 'vitest';

import { buildReleaseNames, parseReleaseArgs, usage } from './cli.js';

describe('buildReleaseNames', () => {
  it('builds release names from the version', () => {
    expect(buildReleaseNames('1.3.0')).toEqual({
      branch: 'release-candidate/v1.3.0',
      majorTag: 'v1',
      prepareRunName: 'Prepare v1.3.0',
      tag: 'v1.3.0',
      verifyRunName: 'Verify v1.3.0',
    });
  });
});

describe('parseReleaseArgs', () => {
  it('parses the default prepare mode', () => {
    expect(parseReleaseArgs(['1.3.0'])).toMatchObject({
      finalizeChangelog: true,
      mode: 'prepare',
      version: '1.3.0',
    });
  });

  it('parses continue mode', () => {
    expect(parseReleaseArgs(['1.3.0', '--continue'])).toMatchObject({
      finalizeChangelog: true,
      mode: 'continue',
      version: '1.3.0',
    });
  });

  it('parses finalize-changelog mode', () => {
    expect(parseReleaseArgs(['1.3.0', '--finalize-changelog'])).toMatchObject({
      finalizeChangelog: true,
      mode: 'finalize-changelog',
      version: '1.3.0',
    });
  });

  it('parses the changelog finalization opt-out', () => {
    expect(parseReleaseArgs(['1.3.0', '--no-finalize-changelog'])).toMatchObject({
      finalizeChangelog: false,
      mode: 'prepare',
      version: '1.3.0',
    });
  });

  it('rejects missing arguments', () => {
    expect(() => parseReleaseArgs([])).toThrow(usage);
  });

  it('rejects too many arguments', () => {
    expect(() => parseReleaseArgs(['1.3.0', '--continue', '--finalize-changelog', '--extra'])).toThrow(
      usage,
    );
  });

  it('rejects non-semver versions', () => {
    expect(() => parseReleaseArgs(['v1.3.0'])).toThrow('expected version input like 1.2.3');
    expect(() => parseReleaseArgs(['1.3'])).toThrow('expected version input like 1.2.3');
  });

  it('rejects unknown flags', () => {
    expect(() => parseReleaseArgs(['1.3.0', '--bogus'])).toThrow(usage);
  });

  it('rejects no-finalize outside prepare mode', () => {
    expect(() => parseReleaseArgs(['1.3.0', '--continue', '--no-finalize-changelog'])).toThrow(
      '--no-finalize-changelog is only valid for the default release preparation mode',
    );
  });
});
