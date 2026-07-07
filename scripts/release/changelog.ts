import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_URL = 'https://github.com/thekbb/expand-aws-iam-wildcards';

export interface FinalizeChangelogOptions {
  date: string;
  repoUrl?: string;
  version: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function finalizeChangelogContent(
  changelog: string,
  { date, repoUrl = DEFAULT_REPO_URL, version }: FinalizeChangelogOptions,
): string {
  if (!/^## \[UNRELEASED\]$/m.test(changelog)) {
    throw new Error('CHANGELOG.md is missing an [UNRELEASED] heading');
  }

  const versionHeadingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\](?:\\s|-|$)`,
    'm',
  );
  if (versionHeadingPattern.test(changelog)) {
    throw new Error(`CHANGELOG.md already has a ${version} heading`);
  }

  const versionLinkPattern = new RegExp(`^\\[${escapeRegExp(version)}\\]:\\s`, 'm');
  if (versionLinkPattern.test(changelog)) {
    throw new Error(`CHANGELOG.md already has a ${version} link`);
  }

  const unreleasedLinkPattern = new RegExp(
    `^\\[Unreleased\\]: ${escapeRegExp(repoUrl)}/compare/v([0-9]+\\.[0-9]+\\.[0-9]+)\\.\\.\\.HEAD$`,
    'm',
  );
  const unreleasedLink = changelog.match(unreleasedLinkPattern);
  if (unreleasedLink?.[1] === undefined) {
    throw new Error('CHANGELOG.md is missing the expected [Unreleased] compare link');
  }

  const previousVersion = unreleasedLink[1];
  const tag = `v${version}`;

  return changelog
    .replace(/^## \[UNRELEASED\]\n/m, `## [UNRELEASED]\n\n## [${version}] - ${date}\n`)
    .replace(
      unreleasedLinkPattern,
      `[Unreleased]: ${repoUrl}/compare/${tag}...HEAD\n[${version}]: ${repoUrl}/compare/v${previousVersion}...${tag}`,
    );
}

export function finalizeChangelogFile(
  changelogPath: string,
  options: FinalizeChangelogOptions,
): void {
  const changelog = readFileSync(changelogPath, 'utf8');
  writeFileSync(changelogPath, finalizeChangelogContent(changelog, options));
}

function main(): void {
  const version = process.argv[2];
  if (version === undefined || version === '') {
    console.error('error: expected version input like 1.2.3');
    process.exit(1);
  }

  try {
    finalizeChangelogFile('CHANGELOG.md', {
      date: process.env.RELEASE_DATE ?? new Date().toISOString().slice(0, 10),
      version,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
