export type ReleaseMode = 'prepare' | 'continue' | 'finalize-changelog';

export interface ReleaseNames {
  branch: string;
  majorTag: string;
  prepareRunName: string;
  tag: string;
  verifyRunName: string;
}

export interface ParsedReleaseArgs {
  finalizeChangelog: boolean;
  mode: ReleaseMode;
  names: ReleaseNames;
  version: string;
}

export const usage = `Usage:
  npm run release -- VERSION
  npm run release -- VERSION --continue
  npm run release -- VERSION --no-finalize-changelog
  npm run release -- VERSION --finalize-changelog

Examples:
  npm run release -- 1.2.8
  npm run release -- 1.2.8 --continue
  npm run release -- 1.2.8 --no-finalize-changelog

Without --continue, prepares a release candidate PR, finalizes CHANGELOG.md, and waits for review.
After you merge that PR, press Enter and the script completes the release.
With --continue, resumes after the release candidate PR is already merged.
With --no-finalize-changelog, expects CHANGELOG.md to already have the release heading and links.
With --finalize-changelog, updates CHANGELOG.md for the release preparation PR.`;

const SEMVER_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export function buildReleaseNames(version: string): ReleaseNames {
  const tag = `v${version}`;
  const majorTag = `v${version.split('.')[0]}`;

  return {
    branch: `release-candidate/${tag}`,
    majorTag,
    prepareRunName: `Prepare ${tag}`,
    tag,
    verifyRunName: `Verify ${tag}`,
  };
}

export function parseReleaseArgs(args: readonly string[]): ParsedReleaseArgs {
  if (args.length < 1 || args.length > 3) {
    throw new Error(usage);
  }

  const version = args[0];
  if (version === undefined || !SEMVER_VERSION_PATTERN.test(version)) {
    throw new Error('expected version input like 1.2.3');
  }

  let mode: ReleaseMode = 'prepare';
  let finalizeChangelog = true;

  for (const arg of args.slice(1)) {
    switch (arg) {
      case '--continue':
        mode = 'continue';
        break;
      case '--finalize-changelog':
        mode = 'finalize-changelog';
        break;
      case '--no-finalize-changelog':
        finalizeChangelog = false;
        break;
      default:
        throw new Error(usage);
    }
  }

  if (mode !== 'prepare' && !finalizeChangelog) {
    throw new Error('--no-finalize-changelog is only valid for the default release preparation mode');
  }

  return {
    finalizeChangelog,
    mode,
    names: buildReleaseNames(version),
    version,
  };
}
