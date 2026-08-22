import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveActionRuntime } from '../release/smoke.js';

export const ACTION_COMMENT_MARKER =
  '<!-- expand-aws-iam-wildcards:review-comment:v1 -->';
export const EXPECTED_S3_DOCUMENTATION_LINK =
  'https://docs.aws.amazon.com/service-authorization/latest/reference/'
    + 'list_s3.html#list_s3-action-GetBucketTagging';
const API_VERSION = '2026-03-10';
const REQUEST_TIMEOUT_MS = 15_000;
const RUNTIME_TIMEOUT_MS = 60_000;
const MAX_RUNTIME_OUTPUT = 2_000_000;
const MAX_PAGINATION_PAGES = 20;
const RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;

export interface ReviewComment {
  readonly id: number;
  readonly body?: string;
  readonly path?: string;
  readonly line?: number | null;
  readonly in_reply_to_id?: number | null;
  readonly user?: {
    readonly type?: string | null;
  } | null;
}

interface PullRequestFixture {
  readonly apiUrl: string;
  readonly eventPath: string;
  readonly fixturePath: string;
  readonly headSha: string;
  readonly owner: string;
  readonly pullNumber: number;
  readonly repo: string;
  readonly repository: string;
  readonly runtime: string;
  readonly token: string;
}

interface RuntimeResult {
  readonly error?: Error;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parseRepository(repository: string): readonly [string, string] {
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error(`Expected E2E_REPOSITORY as owner/repo, got: ${repository}`);
  }
  return parts as [string, string];
}

function parsePullNumber(value: string): number {
  const pullNumber = Number(value);
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    throw new Error(`Expected E2E_PR_NUMBER as a positive integer, got: ${value}`);
  }
  return pullNumber;
}

function parseHeadSha(value: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Expected E2E_HEAD_SHA as a full commit SHA, got: ${value}`);
  }
  return value;
}

export function getNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  for (const entry of linkHeader.split(',')) {
    const match = entry.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === 'next') return match[1] ?? null;
  }
  return null;
}

export function getActionParentComments(
  comments: readonly ReviewComment[],
  fixturePath: string,
): ReviewComment[] {
  return comments.filter((comment) =>
    (comment.in_reply_to_id === null || comment.in_reply_to_id === undefined)
      && comment.path === fixturePath
      && comment.user?.type === 'Bot'
      && comment.body?.split(/\r?\n/).includes(ACTION_COMMENT_MARKER) === true
  );
}

export function assertActionDocumentationLink(comments: readonly ReviewComment[]): void {
  if (!comments.some((comment) => comment.body?.includes(EXPECTED_S3_DOCUMENTATION_LINK))) {
    throw new Error('created comments omitted the current AWS action documentation link');
  }
}

export function assertActionDocumentationPage(
  responseUrl: string,
  responseStatus: number,
  responseBody: string,
): void {
  const expectedUrl = new URL(EXPECTED_S3_DOCUMENTATION_LINK);
  const expectedAnchor = expectedUrl.hash.slice(1);
  expectedUrl.hash = '';

  if (responseStatus !== 200) {
    throw new Error(`AWS action documentation returned HTTP ${responseStatus}`);
  }
  if (responseUrl !== expectedUrl.href) {
    throw new Error(`AWS action documentation redirected to ${responseUrl}`);
  }
  if (!responseBody.includes(`id="${expectedAnchor}"`)) {
    throw new Error(`AWS action documentation omitted anchor ${expectedAnchor}`);
  }
}

function formatOutput(result: RuntimeResult): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
}

export function assertRuntimeResult(
  result: RuntimeResult,
  expectedOutput: readonly string[],
): void {
  if (result.error !== undefined) throw result.error;
  const output = formatOutput(result);
  if (result.status !== 0) {
    throw new Error(`E2E action failed with exit status ${result.status ?? 1}: ${output}`);
  }
  for (const expected of expectedOutput) {
    if (!result.stdout.includes(expected)) {
      throw new Error(`E2E action output omitted: ${expected}\n${output}`);
    }
  }
}

function assertSameIds(
  expected: readonly ReviewComment[],
  actual: readonly ReviewComment[],
  phase: string,
): void {
  const expectedIds = expected.map((comment) => comment.id).toSorted((a, b) => a - b);
  const actualIds = actual.map((comment) => comment.id).toSorted((a, b) => a - b);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      `${phase} changed comment IDs: expected ${expectedIds.join(', ')}, got ${actualIds.join(', ')}`,
    );
  }
}

function assertParentCount(
  comments: readonly ReviewComment[],
  fixturePath: string,
  expectedCount: number,
  phase: string,
): ReviewComment[] {
  const parents = getActionParentComments(comments, fixturePath);
  if (parents.length !== expectedCount) {
    throw new Error(`${phase} expected ${expectedCount} action comments, found ${parents.length}`);
  }
  return parents;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function verifyActionDocumentationPage(): Promise<void> {
  const pageUrl = new URL(EXPECTED_S3_DOCUMENTATION_LINK);
  pageUrl.hash = '';
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(pageUrl, {
        headers: { 'user-agent': 'expand-aws-iam-wildcards-e2e' },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const responseBody = await response.text();
      assertActionDocumentationPage(response.url, response.status, responseBody);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) await delay(RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function githubRequest<T>(
  fixture: PullRequestFixture,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<{ readonly data: T; readonly headers: Headers }> {
  const apiBase = fixture.apiUrl.endsWith('/') ? fixture.apiUrl : `${fixture.apiUrl}/`;
  const url = new URL(pathOrUrl.replace(/^\/+/, ''), apiBase);
  const apiOrigin = new URL(fixture.apiUrl).origin;
  if (url.origin !== apiOrigin) throw new Error(`Refusing E2E API redirect to ${url.origin}`);

  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${fixture.token}`,
      'content-type': 'application/json',
      'user-agent': 'expand-aws-iam-wildcards-e2e',
      'x-github-api-version': API_VERSION,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub API ${init.method ?? 'GET'} ${url.pathname} failed with HTTP ${response.status}: ${responseBody}`,
    );
  }

  return {
    data: (responseBody === '' ? undefined : JSON.parse(responseBody)) as T,
    headers: response.headers,
  };
}

async function listReviewComments(fixture: PullRequestFixture): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = [];
  const visitedUrls = new Set<string>();
  let url: string | null =
    `/repos/${fixture.owner}/${fixture.repo}/pulls/${fixture.pullNumber}/comments?per_page=100`;

  while (url !== null) {
    if (visitedUrls.has(url) || visitedUrls.size >= MAX_PAGINATION_PAGES) {
      throw new Error('GitHub review-comment pagination did not terminate');
    }
    visitedUrls.add(url);
    const response = await githubRequest<ReviewComment[]>(fixture, url);
    if (!Array.isArray(response.data)) throw new Error('GitHub returned invalid review comments');
    comments.push(...response.data);
    url = getNextLink(response.headers.get('link'));
  }
  return comments;
}

async function waitForParentCount(
  fixture: PullRequestFixture,
  expectedCount: number,
  phase: string,
): Promise<{ readonly comments: ReviewComment[]; readonly parents: ReviewComment[] }> {
  let comments: ReviewComment[] = [];

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    comments = await listReviewComments(fixture);
    const parents = getActionParentComments(comments, fixture.fixturePath);
    if (parents.length === expectedCount) return { comments, parents };
    if (attempt < RETRY_ATTEMPTS) await delay(RETRY_DELAY_MS);
  }

  assertParentCount(comments, fixture.fixturePath, expectedCount, phase);
  throw new Error('unreachable parent count assertion');
}

function runAction(
  fixture: PullRequestFixture,
  collapseThreshold: number,
  filePatterns: string,
  expectedOutput: readonly string[],
): void {
  const childEnvironment: NodeJS.ProcessEnv = {};
  const passThroughEnvironment = [
    'GITHUB_ACTIONS',
    'GITHUB_API_URL',
    'GITHUB_GRAPHQL_URL',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
    'GITHUB_SERVER_URL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ] as const;
  for (const name of passThroughEnvironment) {
    const value = process.env[name];
    if (value !== undefined) childEnvironment[name] = value;
  }
  Object.assign(childEnvironment, {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: fixture.eventPath,
    GITHUB_SHA: fixture.headSha,
    'INPUT_COLLAPSE-THRESHOLD': String(collapseThreshold),
    'INPUT_FILE-PATTERNS': filePatterns,
    'INPUT_GITHUB-TOKEN': fixture.token,
  });

  const result = spawnSync(process.execPath, [fixture.runtime], {
    encoding: 'utf8',
    env: childEnvironment,
    maxBuffer: MAX_RUNTIME_OUTPUT,
    timeout: RUNTIME_TIMEOUT_MS,
  });
  const runtimeResult: RuntimeResult = {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  };
  process.stdout.write(runtimeResult.stdout);
  process.stderr.write(runtimeResult.stderr);
  assertRuntimeResult(runtimeResult, expectedOutput);
}

async function createReply(
  fixture: PullRequestFixture,
  commentId: number,
): Promise<ReviewComment> {
  const response = await githubRequest<ReviewComment>(
    fixture,
    `/repos/${fixture.owner}/${fixture.repo}/pulls/${fixture.pullNumber}/comments/${commentId}/replies`,
    {
      method: 'POST',
      body: JSON.stringify({ body: `Automated E2E reply from run ${process.env.GITHUB_RUN_ID ?? 'unknown'}.` }),
    },
  );
  return response.data;
}

function loadFixture(eventPath: string): PullRequestFixture {
  const repository = requiredEnvironment('E2E_REPOSITORY');
  const [owner, repo] = parseRepository(repository);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const actionYaml = readFileSync(join(repositoryRoot, 'action.yml'), 'utf8');
  const outputDirectory = join(repositoryRoot, 'dist');
  const runtime = resolveActionRuntime(actionYaml, outputDirectory);

  return {
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    eventPath,
    fixturePath: requiredEnvironment('E2E_FIXTURE_PATH'),
    headSha: parseHeadSha(requiredEnvironment('E2E_HEAD_SHA')),
    owner,
    pullNumber: parsePullNumber(requiredEnvironment('E2E_PR_NUMBER')),
    repo,
    repository,
    runtime,
    token: requiredEnvironment('E2E_TOKEN'),
  };
}

export async function runPullRequestE2e(): Promise<void> {
  const eventDirectory = mkdtempSync(join(tmpdir(), 'expand-aws-iam-wildcards-e2e-'));
  const eventPath = join(eventDirectory, 'event.json');

  try {
    const fixture = loadFixture(eventPath);
    writeFileSync(eventPath, JSON.stringify({
      pull_request: {
        number: fixture.pullNumber,
        head: { sha: fixture.headSha },
      },
      repository: { full_name: fixture.repository },
    }));

    console.log('E2E phase: create comments');
    runAction(fixture, 100, fixture.fixturePath, [
      'Synchronized comments: 2 created, 0 updated, 0 unchanged',
    ]);
    const first = await waitForParentCount(fixture, 2, 'create');
    assertActionDocumentationLink(first.parents);
    await verifyActionDocumentationPage();
    if (first.parents.some((comment) => comment.body?.includes('<details>'))) {
      throw new Error('create phase unexpectedly collapsed an action list');
    }

    console.log('E2E phase: unchanged rerun');
    runAction(fixture, 100, fixture.fixturePath, [
      'Synchronized comments: 0 created, 0 updated, 2 unchanged',
    ]);
    const rerun = await waitForParentCount(fixture, 2, 'rerun');
    assertSameIds(first.parents, rerun.parents, 'rerun');
    const firstBodies = first.parents.map((comment) => comment.body).toSorted();
    const rerunBodies = rerun.parents.map((comment) => comment.body).toSorted();
    if (JSON.stringify(firstBodies) !== JSON.stringify(rerunBodies)) {
      throw new Error('unchanged rerun modified an action comment body');
    }

    console.log('E2E phase: update comments in place');
    runAction(fixture, 1, fixture.fixturePath, [
      'Synchronized comments: 0 created, 2 updated, 0 unchanged',
    ]);
    const updated = await waitForParentCount(fixture, 2, 'update');
    assertSameIds(first.parents, updated.parents, 'update');
    if (updated.parents.some((comment) => !comment.body?.includes('<details>'))) {
      throw new Error('update phase did not collapse every action list');
    }

    const [protectedParent, unprotectedParent] = updated.parents.toSorted((a, b) =>
      (a.line ?? 0) - (b.line ?? 0)
    );
    if (!protectedParent || !unprotectedParent) {
      throw new Error('update phase did not return two comment anchors');
    }

    console.log('E2E phase: add a real review reply');
    const reply = await createReply(fixture, protectedParent.id);
    if (reply.in_reply_to_id !== protectedParent.id) {
      throw new Error(`GitHub created reply ${reply.id} without the expected parent`);
    }

    console.log('E2E phase: delete stale comments while preserving replied threads');
    runAction(fixture, 1, '**/*.never', [
      'Deleted 1 existing comment(s) from previous runs',
      'Preserved 1 stale comment thread(s)',
      'No files matched the configured patterns.',
    ]);
    const cleaned = await waitForParentCount(fixture, 1, 'cleanup');
    if (cleaned.parents[0]?.id !== protectedParent.id) {
      throw new Error('cleanup did not preserve the replied action comment');
    }
    if (cleaned.comments.some((comment) => comment.id === unprotectedParent.id)) {
      throw new Error('cleanup did not delete the unreplied action comment');
    }
    if (!cleaned.comments.some((comment) =>
      comment.id === reply.id && comment.in_reply_to_id === protectedParent.id
    )) {
      throw new Error('cleanup did not preserve the review reply');
    }

    console.log(`E2E lifecycle passed for pull request #${fixture.pullNumber}.`);
  } finally {
    rmSync(eventDirectory, { force: true, recursive: true });
  }
}

const entryPoint = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href;
if (entryPoint === import.meta.url) {
  void runPullRequestE2e().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
