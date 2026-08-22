import { type ReleaseRuntime, requireCommand, runChecked, runText } from './command.js';

export interface WorkflowRun {
  databaseId: number;
  displayTitle: string;
}

export interface PullRequestSummary {
  mergeCommit?: { oid?: string } | null;
  state?: string;
  url?: string;
}

export interface ReleaseView {
  isDraft: boolean;
  isImmutable?: boolean;
  tagName: string;
  url?: string;
}

interface CommitSignature {
  __typename?: string;
  isValid?: boolean;
  keyId?: string | null;
  signer?: { login?: string } | null;
  state?: string;
  wasSignedByGitHub?: boolean;
}

interface CommitSignatureResponse {
  data?: {
    repository?: {
      object?: {
        oid?: string;
        signature?: CommitSignature | null;
      } | null;
    } | null;
  };
}

const RELEASE_REPOSITORY_OWNER = 'thekbb';
const RELEASE_REPOSITORY_NAME = 'expand-aws-iam-wildcards';
const GITHUB_WEB_FLOW_SIGNER = 'web-flow';
const GITHUB_WEB_FLOW_SIGNING_KEY_IDS = new Set(['B5690EEEBB952194']);

export const GITHUB_COMMIT_SIGNATURE_QUERY =
  'query($owner:String!,$name:String!,$oid:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{oid signature{__typename isValid signer{login} state wasSignedByGitHub ... on GpgSignature{keyId}}}}}}';

export interface GitHubClient {
  assertReleaseCommitSignature: (sha: string) => void;
  authStatus: () => void;
  createDraftRelease: (tag: string) => void;
  dispatchPrepareRelease: (version: string, finalizeChangelog: boolean) => void;
  dispatchVerifyDraftRelease: (tag: string) => void;
  firstPullRequest: (branch: string, fields: string) => PullRequestSummary | undefined;
  latestWorkflowRunId: (workflow: string, runName: string, branch?: string) => string;
  requireAvailable: () => void;
  viewRelease: (tag: string, fields?: string) => ReleaseView | undefined;
  watchRun: (runId: string) => void;
}

function listWorkflowRuns(
  runtime: ReleaseRuntime,
  workflow: string,
  branch?: string,
): readonly WorkflowRun[] {
  const args = ['run', 'list', '--workflow', workflow, '--event', 'workflow_dispatch', '--limit', '50', '--json', 'databaseId,displayTitle'];
  if (branch !== undefined && branch !== '') {
    args.push('--branch', branch);
  }

  return JSON.parse(runText(runtime, 'gh', args)) as WorkflowRun[];
}

export function createGitHubClient(runtime: ReleaseRuntime): GitHubClient {
  return {
    assertReleaseCommitSignature: (sha) => {
      const response = JSON.parse(
        runText(runtime, 'gh', [
          'api',
          'graphql',
          '-f',
          `query=${GITHUB_COMMIT_SIGNATURE_QUERY}`,
          '-f',
          `owner=${RELEASE_REPOSITORY_OWNER}`,
          '-f',
          `name=${RELEASE_REPOSITORY_NAME}`,
          '-f',
          `oid=${sha}`,
        ]),
      ) as CommitSignatureResponse;
      const commit = response.data?.repository?.object;
      if (commit?.oid !== sha) {
        throw new Error(`GitHub returned the wrong release commit: ${commit?.oid ?? 'missing'}, expected ${sha}`);
      }

      const signature = commit.signature;
      if (signature === null || signature === undefined) {
        throw new Error(`release commit ${sha} is unsigned`);
      }

      if (signature.isValid !== true || signature.state !== 'VALID') {
        throw new Error(`release commit ${sha} signature is not verified: ${signature.state ?? 'UNKNOWN'}`);
      }

      if (signature.wasSignedByGitHub !== true || signature.signer?.login !== GITHUB_WEB_FLOW_SIGNER) {
        throw new Error(`release commit ${sha} was not signed by GitHub web-flow`);
      }

      if (signature.__typename !== 'GpgSignature' ||
          signature.keyId === null ||
          signature.keyId === undefined ||
          !GITHUB_WEB_FLOW_SIGNING_KEY_IDS.has(signature.keyId)) {
        throw new Error(`release commit ${sha} uses an unapproved GitHub signing key: ${signature.keyId ?? 'unknown'}`);
      }
    },
    authStatus: () => runChecked(runtime, 'gh', ['auth', 'status']),
    createDraftRelease: (tag) => runChecked(runtime, 'gh', ['release', 'create', tag, '--draft', '--verify-tag', '--generate-notes']),
    dispatchPrepareRelease: (version, finalizeChangelog) =>
      runChecked(runtime, 'gh', [
        'workflow',
        'run',
        'prepare-release.yml',
        '-f',
        `version=${version}`,
        '-f',
        `finalize_changelog=${String(finalizeChangelog)}`,
      ]),
    dispatchVerifyDraftRelease: (tag) =>
      runChecked(runtime, 'gh', ['workflow', 'run', 'verify-draft-release.yml', '--ref', tag, '-f', `tag=${tag}`]),
    firstPullRequest: (branch, fields) => {
      const pullRequests = JSON.parse(
        runText(runtime, 'gh', [
          'pr',
          'list',
          '--state',
          'all',
          '--head',
          branch,
          '--base',
          'main',
          '--json',
          fields,
        ]),
      ) as PullRequestSummary[];

      return pullRequests[0];
    },
    latestWorkflowRunId: (workflow, runName, branch) =>
      String(listWorkflowRuns(runtime, workflow, branch).find((run) => run.displayTitle === runName)?.databaseId ?? ''),
    requireAvailable: () => requireCommand(runtime, 'gh'),
    viewRelease: (tag, fields = 'isDraft,isImmutable,tagName,url') => {
      const result = runtime.run('gh', ['release', 'view', tag, '--json', fields]);
      if (result.status !== 0) {
        return undefined;
      }

      return JSON.parse(result.stdout) as ReleaseView;
    },
    watchRun: (runId) => runChecked(runtime, 'gh', ['run', 'watch', runId, '--exit-status'], { stdio: 'inherit' }),
  };
}
