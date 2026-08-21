import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveActionRuntime } from './release/smoke.js';

const OWNER = 'thekbb';
const REPOSITORY = 'expand-aws-iam-wildcards';
const PULL_NUMBER = 42;
const TOKEN = 'compiled-integration-token';
const REQUEST_BODY_LIMIT = 1_000_000;
const RUNTIME_OUTPUT_LIMIT = 2_000_000;
const RUNTIME_TIMEOUT_MS = 20_000;

interface ApiPullRequestFile {
  readonly filename: string;
  readonly patch: string;
}

interface ApiReviewComment {
  readonly id: number;
  readonly body: string;
  readonly path: string;
  readonly line: number;
  readonly position: number;
  readonly user: {
    readonly login: string;
    readonly type: 'Bot' | 'User';
  };
}

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
}

interface RuntimeResult {
  readonly outputExceeded: boolean;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
}

interface GithubFixture {
  readonly apiUrl: string;
  readonly comments: ApiReviewComment[];
  readonly requests: RecordedRequest[];
  readonly failures: string[];
  close: () => Promise<void>;
  setFiles: (files: readonly ApiPullRequestFile[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > REQUEST_BODY_LIMIT) throw new Error('request body exceeded fixture limit');
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return body === '' ? undefined : JSON.parse(body) as unknown;
}

function getPage(url: URL): number {
  const page = Number(url.searchParams.get('page') ?? '1');
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function getNextPageHeader(apiUrl: string, pathname: string): string {
  return `<${apiUrl}${pathname}?per_page=100&page=2>; rel="next"`;
}

function makeFillerFiles(): ApiPullRequestFile[] {
  return Array.from({ length: 100 }, (_, index) => ({
    filename: `fixtures/pagination/file-${index}.txt`,
    patch: '',
  }));
}

function makeFillerComments(): ApiReviewComment[] {
  return Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    body: `Unrelated review comment ${index + 1}`,
    path: `fixtures/pagination/file-${index}.txt`,
    line: 1,
    position: 1,
    user: { login: 'reviewer', type: 'User' },
  }));
}

async function startGithubFixture(): Promise<GithubFixture> {
  const comments: ApiReviewComment[] = [];
  const requests: RecordedRequest[] = [];
  const failures: string[] = [];
  const fillerFiles = makeFillerFiles();
  const fillerComments = makeFillerComments();
  let files: readonly ApiPullRequestFile[] = [];
  let nextCommentId = 1000;
  let apiUrl = '';

  const server = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? 'GET';
      const url = new URL(request.url ?? '/', apiUrl);
      requests.push({ method, path: `${url.pathname}${url.search}` });

      if (request.headers.authorization !== `token ${TOKEN}`) {
        sendJson(response, 401, { message: 'bad fixture token' });
        return;
      }

      const pullPath = `/repos/${OWNER}/${REPOSITORY}/pulls/${PULL_NUMBER}`;
      if (method === 'GET' && url.pathname === `${pullPath}/files`) {
        const page = getPage(url);
        sendJson(
          response,
          200,
          page === 1 ? fillerFiles : page === 2 ? files : [],
          page === 1 ? { link: getNextPageHeader(apiUrl, url.pathname) } : {},
        );
        return;
      }

      if (method === 'GET' && url.pathname === `${pullPath}/comments`) {
        const page = getPage(url);
        sendJson(
          response,
          200,
          page === 1 ? fillerComments : page === 2 ? comments : [],
          page === 1 ? { link: getNextPageHeader(apiUrl, url.pathname) } : {},
        );
        return;
      }

      if (method === 'GET' && url.pathname === '/user') {
        sendJson(response, 200, { login: 'github-actions[bot]' });
        return;
      }

      if (method === 'POST' && url.pathname === `${pullPath}/reviews`) {
        const body = await readJson(request);
        if (
          !isRecord(body)
          || !Array.isArray(body.comments)
          || body.event !== 'COMMENT'
          || body.commit_id !== 'deadbeefcafebabe'
        ) {
          sendJson(response, 422, { message: 'invalid review fixture request' });
          return;
        }

        for (const value of body.comments) {
          if (
            !isRecord(value)
            || typeof value.path !== 'string'
            || typeof value.line !== 'number'
            || typeof value.body !== 'string'
          ) {
            sendJson(response, 422, { message: 'invalid review comment fixture request' });
            return;
          }
          comments.push({
            id: nextCommentId++,
            path: value.path,
            line: value.line,
            position: value.line,
            body: value.body,
            user: { login: 'github-actions[bot]', type: 'Bot' },
          });
        }

        sendJson(response, 200, { id: 1 });
        return;
      }

      const commentMatch = url.pathname.match(
        new RegExp(`^/repos/${OWNER}/${REPOSITORY}/pulls/comments/(\\d+)$`),
      );
      if (commentMatch) {
        const commentId = Number(commentMatch[1]);
        const commentIndex = comments.findIndex((comment) => comment.id === commentId);
        if (commentIndex < 0) {
          sendJson(response, 404, { message: 'fixture comment not found' });
          return;
        }

        if (method === 'PATCH') {
          const body = await readJson(request);
          if (!isRecord(body) || typeof body.body !== 'string') {
            sendJson(response, 422, { message: 'invalid update fixture request' });
            return;
          }
          const comment = comments[commentIndex];
          if (!comment) throw new Error(`missing fixture comment ${commentId}`);
          comments[commentIndex] = { ...comment, body: body.body };
          sendJson(response, 200, comments[commentIndex]);
          return;
        }

        if (method === 'DELETE') {
          comments.splice(commentIndex, 1);
          response.writeHead(204);
          response.end();
          return;
        }
      }

      sendJson(response, 404, { message: `unexpected fixture route: ${method} ${url.pathname}` });
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      if (!response.headersSent) sendJson(response, 500, { message });
      else response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('compiled integration fixture did not bind a TCP port');
  }
  apiUrl = `http://127.0.0.1:${address.port}`;
  server.on('error', (error) => failures.push(error.message));

  return {
    apiUrl,
    comments,
    requests,
    failures,
    setFiles: (nextFiles) => {
      files = nextFiles;
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}

function runRuntime(runtime: string, eventPath: string, apiUrl: string): Promise<RuntimeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtime], {
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_API_URL: apiUrl,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_GRAPHQL_URL: `${apiUrl}/graphql`,
        GITHUB_REPOSITORY: `${OWNER}/${REPOSITORY}`,
        GITHUB_RUN_ID: '17000000001',
        GITHUB_SERVER_URL: apiUrl,
        GITHUB_SHA: 'deadbeefcafebabe',
        'INPUT_COLLAPSE-THRESHOLD': '5',
        'INPUT_FILE-PATTERNS': '**/*.tf',
        'INPUT_GITHUB-TOKEN': TOKEN,
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputExceeded = false;
    let timedOut = false;

    const enforceOutputLimit = (): void => {
      if (!outputExceeded && stdout.length + stderr.length > RUNTIME_OUTPUT_LIMIT) {
        outputExceeded = true;
        child.kill('SIGKILL');
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      enforceOutputLimit();
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      enforceOutputLimit();
    });
    child.once('error', reject);

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, RUNTIME_TIMEOUT_MS);

    child.once('close', (status) => {
      clearTimeout(timeout);
      resolve({ outputExceeded, status, stdout, stderr, timedOut });
    });
  });
}

function assertRuntimeOutput(result: RuntimeResult, expectedOutput: string): void {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  if (result.outputExceeded) {
    throw new Error(`compiled integration runtime exceeded output limit: ${output}`);
  }
  if (result.timedOut) throw new Error(`compiled integration runtime timed out: ${output}`);
  if (result.status !== 0) {
    throw new Error(`compiled integration runtime failed with exit status ${result.status ?? 1}: ${output}`);
  }
  if (!result.stdout.includes(expectedOutput)) {
    throw new Error(`compiled integration runtime omitted expected output: ${expectedOutput}\n${output}`);
  }
}

function wildcardFile(action: string): ApiPullRequestFile {
  return {
    filename: 'fixtures/integration/policy.tf',
    patch: `@@ -1 +1 @@\n-"s3:GetObject"\n+"${action}"`,
  };
}

function countRequests(
  requests: readonly RecordedRequest[],
  method: string,
  pathPattern: RegExp,
): number {
  return requests.filter((request) =>
    request.method === method && pathPattern.test(request.path)
  ).length;
}

function countComments(comments: readonly ApiReviewComment[]): number {
  return comments.length;
}

export async function integrationTestAction(
  actionYaml: string,
  outputDirectory: string,
): Promise<void> {
  const eventDirectory = mkdtempSync(join(tmpdir(), 'expand-aws-iam-wildcards-integration-'));
  const eventPath = join(eventDirectory, 'event.json');
  let closeFixture: (() => Promise<void>) | undefined;

  try {
    const fixture = await startGithubFixture();
    closeFixture = fixture.close;
    writeFileSync(eventPath, JSON.stringify({
      pull_request: {
        number: PULL_NUMBER,
        head: { sha: 'deadbeefcafebabe' },
      },
    }));
    const runtime = resolveActionRuntime(actionYaml, outputDirectory);
    const run = async (expectedOutput: string): Promise<void> => {
      assertRuntimeOutput(await runRuntime(runtime, eventPath, fixture.apiUrl), expectedOutput);
    };

    fixture.setFiles([wildcardFile('s3:Get*Tagging')]);
    await run('Synchronized comments: 1 created, 0 updated, 0 unchanged');
    if (countComments(fixture.comments) !== 1) {
      throw new Error('compiled create flow did not create one comment');
    }

    await run('Synchronized comments: 0 created, 0 updated, 1 unchanged');

    fixture.setFiles([wildcardFile('s3:PutObject*')]);
    await run('Synchronized comments: 0 created, 1 updated, 0 unchanged');
    if (!fixture.comments[0]?.body.includes('`s3:PutObject*`')) {
      throw new Error('compiled update flow did not replace the existing comment body');
    }

    fixture.setFiles([{
      filename: 'fixtures/integration/policy.tf',
      patch: '@@ -1 +1 @@\n-"s3:Get*Tagging"\n+"s3:GetObject"',
    }]);
    await run('Deleted 1 existing comment(s) from previous runs');
    if (countComments(fixture.comments) !== 0) {
      throw new Error('compiled cleanup flow left a stale comment');
    }

    const mutationsBeforeNoops = countRequests(
      fixture.requests,
      'POST',
      new RegExp(`/pulls/${PULL_NUMBER}/reviews$`),
    ) + countRequests(fixture.requests, 'PATCH', /\/pulls\/comments\/\d+$/)
      + countRequests(fixture.requests, 'DELETE', /\/pulls\/comments\/\d+$/);
    fixture.setFiles([{ filename: 'notes.txt', patch: '@@ -0,0 +1 @@\n+notes' }]);
    await run('No files matched the configured patterns.');
    fixture.setFiles([wildcardFile('unknown-service:*')]);
    await run('No wildcard actions could be expanded.');
    const mutationsAfterNoops = countRequests(
      fixture.requests,
      'POST',
      new RegExp(`/pulls/${PULL_NUMBER}/reviews$`),
    ) + countRequests(fixture.requests, 'PATCH', /\/pulls\/comments\/\d+$/)
      + countRequests(fixture.requests, 'DELETE', /\/pulls\/comments\/\d+$/);
    if (mutationsAfterNoops !== mutationsBeforeNoops) {
      throw new Error('compiled no-op flows mutated review comments');
    }

    fixture.setFiles([wildcardFile('ec2:*')]);
    await run('Truncated 1 review comment(s) to stay within GitHub comment limits.');
    const truncatedBody = fixture.comments[0]?.body;
    if (!truncatedBody?.includes('GitHub limits') || truncatedBody.length > 62_000) {
      throw new Error('compiled truncation flow did not create a bounded comment');
    }

    const filesPageTwo = `/pulls/${PULL_NUMBER}/files?per_page=100&page=2`;
    const commentsPageTwo = `/pulls/${PULL_NUMBER}/comments?per_page=100&page=2`;
    if (!fixture.requests.some((request) => request.path.endsWith(filesPageTwo))) {
      throw new Error('compiled integration did not paginate pull request files');
    }
    if (!fixture.requests.some((request) => request.path.endsWith(commentsPageTwo))) {
      throw new Error('compiled integration did not paginate review comments');
    }
    if (fixture.failures.length > 0) {
      throw new Error(`compiled integration fixture failed: ${fixture.failures.join('; ')}`);
    }
  } finally {
    try {
      await closeFixture?.();
    } finally {
      rmSync(eventDirectory, { force: true, recursive: true });
    }
  }
}
