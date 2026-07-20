import { finalizeChangelogFile } from './changelog.js';
import { type ReleaseRuntime, runChecked } from './command.js';
import { type ParsedReleaseArgs } from './cli.js';
import { createGitClient, type GitClient } from './git.js';
import { createGitHubClient, type GitHubClient } from './github.js';

export interface ReleaseServices {
  git: GitClient;
  github: GitHubClient;
  runtime: ReleaseRuntime;
}

export function createReleaseServices(runtime: ReleaseRuntime): ReleaseServices {
  return {
    git: createGitClient(runtime),
    github: createGitHubClient(runtime),
    runtime,
  };
}

function requireCleanMain({ git }: ReleaseServices): void {
  if (git.currentBranch() !== 'main') {
    throw new Error('release must run from main');
  }

  git.fetchMainAndTags();

  if (git.headSha() !== git.originMainSha()) {
    throw new Error('local main must match origin/main');
  }

  if (git.statusPorcelain() !== '') {
    throw new Error('working tree must be clean');
  }
}

function syncCleanMain({ git }: ReleaseServices): void {
  if (git.currentBranch() !== 'main') {
    throw new Error('release must run from main');
  }

  if (git.statusPorcelain() !== '') {
    throw new Error('working tree must be clean');
  }

  git.fetchMainAndTags();
  git.mergeFfOnlyOriginMain();
}

function findNewWorkflowRun(
  { github, runtime }: ReleaseServices,
  workflow: string,
  runName: string,
  previousRunId: string,
  branch?: string,
): string {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    runtime.sleep(2_000);
    const runId = github.latestWorkflowRunId(workflow, runName, branch);
    if (runId !== '' && runId !== previousRunId) {
      return runId;
    }
  }

  throw new Error(`could not find the newly dispatched ${runName} workflow run`);
}

function requireReleasedChangelog(changelog: string, version: string, label: string): void {
  if (!new RegExp(`^## \\[${version}\\] - `, 'm').test(changelog)) {
    throw new Error(`${label} is missing a dated ${version} heading`);
  }

  if (!new RegExp(`^\\[${version}\\]: .*v${version}$`, 'm').test(changelog)) {
    throw new Error(`${label} is missing the ${version} compare link`);
  }
}

function requireChangelogReady({ git }: ReleaseServices, args: ParsedReleaseArgs): void {
  const changelog = git.showFile('HEAD:CHANGELOG.md');
  if (args.finalizeChangelog) {
    if (!/^## \[UNRELEASED\]$/m.test(changelog)) {
      throw new Error('CHANGELOG.md is missing an [UNRELEASED] entry');
    }
    return;
  }

  requireReleasedChangelog(changelog, args.version, 'CHANGELOG.md');
}

function prepareRelease(services: ReleaseServices, args: ParsedReleaseArgs): void {
  const { git, github, runtime } = services;
  runtime.stdout.log(`Running release preflight for ${args.names.tag}`);

  github.authStatus();
  requireCleanMain(services);
  git.assertSigningKeyAvailable();
  requireChangelogReady(services, args);

  if (git.hasLocalTag(args.names.tag)) {
    throw new Error(`local tag already exists: ${args.names.tag}`);
  }

  if (git.refExistsOnOrigin(`refs/tags/${args.names.tag}`)) {
    throw new Error(`remote tag already exists: ${args.names.tag}`);
  }

  if (git.refExistsOnOrigin(`refs/heads/${args.names.branch}`)) {
    throw new Error(`remote release candidate branch already exists: ${args.names.branch}`);
  }

  runtime.stdout.log(`Dispatching Prepare Release for ${args.names.tag}`);

  const previousRunId = github.latestWorkflowRunId('prepare-release.yml', args.names.prepareRunName);
  github.dispatchPrepareRelease(args.version, args.finalizeChangelog);
  const runId = findNewWorkflowRun(services, 'prepare-release.yml', args.names.prepareRunName, previousRunId);

  github.watchRun(runId);

  const prUrl = github.firstPullRequest(args.names.branch, 'url')?.url;
  if (prUrl === undefined || prUrl === '') {
    throw new Error(`Prepare Release completed, but no release preparation PR was found for ${args.names.branch}`);
  }

  runtime.stdout.log(`
Release preparation PR is ready:
${prUrl}

Review and merge the release preparation PR before continuing.

If this script is still running, press Enter after the PR is merged.
To resume later instead, run:
npm run release -- ${args.version} --continue

Release state:
  version:   ${args.version}
  tag:       ${args.names.tag}
  major tag: ${args.names.majorTag}
  branch:    ${args.names.branch}`);

  if (!runtime.stdinIsTTY) {
    runtime.stdout.log('');
    runtime.stdout.log(`No interactive terminal detected; run npm run release -- ${args.version} --continue after merging the PR.`);
    return;
  }

  runtime.promptEnter('Press Enter after the release preparation PR is merged, or Ctrl-C to resume later with --continue. ');
  continueRelease(services, args);
}

function ensureVersionTag({ git, runtime }: ReleaseServices, args: ParsedReleaseArgs, releaseSha: string): void {
  if (git.hasLocalTag(args.names.tag)) {
    const localTagCommit = git.localTagCommit(args.names.tag);
    if (localTagCommit !== releaseSha) {
      throw new Error(`local tag ${args.names.tag} points to ${localTagCommit}, expected ${releaseSha}`);
    }
  }

  if (git.refExistsOnOrigin(`refs/tags/${args.names.tag}`)) {
    const remoteTagCommit =
      git.remoteAnnotatedTagCommit(args.names.tag) || git.remoteRefSha(`refs/tags/${args.names.tag}`);

    if (remoteTagCommit !== releaseSha) {
      throw new Error(`remote tag ${args.names.tag} points to ${remoteTagCommit}, expected ${releaseSha}`);
    }

    runtime.stdout.log(`Release tag already exists on origin: ${args.names.tag}`);
    return;
  }

  if (!git.hasLocalTag(args.names.tag)) {
    git.createSignedTag(args.names.tag, releaseSha);
  }

  git.pushTag(args.names.tag);
}

function ensureDraftRelease({ github, runtime }: ReleaseServices, args: ParsedReleaseArgs): void {
  const release = github.viewRelease(args.names.tag);
  if (release !== undefined) {
    if (release.isDraft) {
      runtime.stdout.log(`Draft release already exists for ${args.names.tag}`);
    } else {
      runtime.stdout.log(`Release already exists for ${args.names.tag}`);
    }
    runtime.stdout.log(JSON.stringify(release));
    return;
  }

  github.createDraftRelease(args.names.tag);
  runtime.stdout.log(JSON.stringify(github.viewRelease(args.names.tag, 'isDraft,tagName,url')));
}

function waitForPublishedRelease({ github, runtime }: ReleaseServices, tag: string): boolean {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const release = github.viewRelease(tag);
    if (release?.isDraft === false && release.isImmutable === true) {
      return true;
    }

    runtime.sleep(5_000);
  }

  return false;
}

function verifyAndPublishRelease(services: ReleaseServices, args: ParsedReleaseArgs): void {
  const { github, runtime } = services;
  const release = github.viewRelease(args.names.tag);
  if (release?.isDraft === false && release.isImmutable === true) {
    runtime.stdout.log(`Release ${args.names.tag} is already published and immutable`);
    return;
  }

  runtime.stdout.log(`Dispatching Verify Draft Release for ${args.names.tag}`);

  const previousRunId = github.latestWorkflowRunId('verify-draft-release.yml', args.names.verifyRunName, args.names.tag);
  github.dispatchVerifyDraftRelease(args.names.tag);
  const runId = findNewWorkflowRun(
    services,
    'verify-draft-release.yml',
    args.names.verifyRunName,
    previousRunId,
    args.names.tag,
  );

  github.watchRun(runId);

  runtime.stdout.log(`Waiting for ${args.names.tag} to be published and immutable`);
  if (!waitForPublishedRelease(services, args.names.tag)) {
    throw new Error(`release ${args.names.tag} was not published as immutable; inspect Publish Verified Release runs`);
  }
}

function moveMajorTag({ git }: ReleaseServices, args: ParsedReleaseArgs, releaseSha: string): void {
  const oldMajorTag = git.remoteRefSha(`refs/tags/${args.names.majorTag}`);

  git.createOrReplaceSignedTag(args.names.majorTag, `${args.names.tag}^{commit}`);

  if (oldMajorTag !== '') {
    git.forcePushTagWithLease(args.names.majorTag, oldMajorTag);
  } else {
    git.pushTag(args.names.majorTag);
  }

  const remoteMajorCommit = git.remoteAnnotatedTagCommit(args.names.majorTag);
  if (remoteMajorCommit !== releaseSha) {
    throw new Error(`remote major tag ${args.names.majorTag} points to ${remoteMajorCommit}, expected ${releaseSha}`);
  }
}

function fileVersionAt({ git }: ReleaseServices, releaseSha: string, path: string): string {
  return JSON.parse(git.showFile(`${releaseSha}:${path}`))['version'] as string;
}

function continueRelease(services: ReleaseServices, args: ParsedReleaseArgs): void {
  const { git, github, runtime } = services;
  runtime.stdout.log(`Continuing release for ${args.names.tag}`);

  github.authStatus();
  syncCleanMain(services);
  git.assertSigningKeyAvailable();

  const pullRequest = github.firstPullRequest(args.names.branch, 'state,mergeCommit');
  if (pullRequest === undefined || pullRequest.state === undefined || pullRequest.state === '') {
    throw new Error(`could not find a release preparation pull request for ${args.names.branch}`);
  }

  if (pullRequest.state !== 'MERGED') {
    throw new Error(`${args.names.branch} pull request must be merged before continuing; current state: ${pullRequest.state}`);
  }

  const releaseSha = pullRequest.mergeCommit?.oid ?? '';
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error('could not resolve release preparation PR merge commit');
  }

  git.assertReleaseCommitOnOriginMain(releaseSha);

  const packageVersion = fileVersionAt(services, releaseSha, 'package.json');
  const lockfileVersion = fileVersionAt(services, releaseSha, 'package-lock.json');
  if (packageVersion !== args.version) {
    throw new Error(`package.json at ${releaseSha} has version ${packageVersion}, expected ${args.version}`);
  }

  if (lockfileVersion !== args.version) {
    throw new Error(`package-lock.json at ${releaseSha} has version ${lockfileVersion}, expected ${args.version}`);
  }

  requireReleasedChangelog(
    git.showFile(`${releaseSha}:CHANGELOG.md`),
    args.version,
    `CHANGELOG.md at ${releaseSha}`,
  );

  ensureVersionTag(services, args, releaseSha);
  ensureDraftRelease(services, args);
  verifyAndPublishRelease(services, args);

  runChecked(runtime, './verify-release.sh', ['--tag', args.names.tag], { stdio: 'inherit' });
  moveMajorTag(services, args, releaseSha);

  runtime.stdout.log(`
Release complete:
  version:   ${args.version}
  tag:       ${args.names.tag}
  major tag: ${args.names.majorTag}
  commit:    ${releaseSha}`);
}

export function runRelease(args: ParsedReleaseArgs, services: ReleaseServices): void {
  if (args.mode === 'finalize-changelog') {
    finalizeChangelogFile('CHANGELOG.md', {
      date: services.runtime.env.RELEASE_DATE ?? new Date().toISOString().slice(0, 10),
      version: args.version,
    });
    return;
  }

  services.git.requireAvailable();
  services.github.requireAvailable();

  if (args.mode === 'continue') {
    continueRelease(services, args);
    return;
  }

  prepareRelease(services, args);
}
