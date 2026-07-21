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

export interface GitHubClient {
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
