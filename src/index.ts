import * as core from '@actions/core';
import * as github from '@actions/github';

import { processFiles, COMMENT_MARKER, type TruncatedComment } from './action.js';
import {
  listActionReviewComments,
  listPullRequestFiles,
  syncReviewComments,
  type SyncReviewCommentsResult,
} from './github.js';

function getWorkflowRunUrl(owner: string, repo: string): string | undefined {
  const runId = process.env.GITHUB_RUN_ID;
  if (!runId) {
    return undefined;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
}

function logTruncatedComments(
  truncatedComments: readonly TruncatedComment[],
  workflowRunUrl?: string,
): void {
  if (truncatedComments.length === 0) {
    return;
  }

  const logLocation = workflowRunUrl ? ` Full lists are available in this workflow run: ${workflowRunUrl}` : '';
  core.warning(
    `Truncated ${truncatedComments.length} review comment(s) to stay within GitHub comment limits.${logLocation}`
  );

  for (const truncatedComment of truncatedComments) {
    core.info([
      `Full IAM expansion for ${truncatedComment.file}:${truncatedComment.line}`,
      `Rendered ${truncatedComment.renderedActionsCount} of ${truncatedComment.expandedActions.length} action(s) in the PR comment.`,
      `Wildcard patterns: ${truncatedComment.originalActions.join(', ')}`,
      ...truncatedComment.expandedActions.map((action) => `- ${action}`),
    ].join('\n'));
  }
}

function logReviewCommentSyncResult(result: SyncReviewCommentsResult): void {
  if (result.createdCount > 0 || result.updatedCount > 0 || result.unchangedCount > 0) {
    core.info(
      `Synchronized comments: ${result.createdCount} created, ${result.updatedCount} updated, ${result.unchangedCount} unchanged`
    );
  }

  if (result.deletedCount > 0) {
    core.info(`Deleted ${result.deletedCount} existing comment(s) from previous runs`);
  }

  if (result.failedDeleteCount > 0) {
    core.warning(`Failed to delete ${result.failedDeleteCount} stale comment(s) from previous runs`);
  }
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const collapseThreshold = parseInt(core.getInput('collapse-threshold') || '5', 10);
    const filePatterns = core.getInput('file-patterns')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const octokit = github.getOctokit(token);
    const { context } = github;

    if (!context.payload.pull_request) {
      core.info('This action only runs on pull requests. Skipping.');
      return;
    }

    const { owner, repo } = context.repo;
    const pullNumber = context.payload.pull_request.number as number;
    const commitSha = context.payload.pull_request.head.sha as string;
    const workflowRunUrl = getWorkflowRunUrl(owner, repo);

    core.info(`Analyzing PR #${pullNumber} in ${owner}/${repo}`);

    const existingComments = await listActionReviewComments(
      octokit,
      owner,
      repo,
      pullNumber,
      COMMENT_MARKER,
    );

    const files = await listPullRequestFiles(octokit, owner, repo, pullNumber);

    const { comments, redundantActions, stats, truncatedComments } = processFiles(
      files,
      filePatterns,
      collapseThreshold,
      { truncationUrl: workflowRunUrl },
    );

    if (stats.filesScanned === 0) {
      logReviewCommentSyncResult(await syncReviewComments(octokit, {
        owner,
        repo,
        pullNumber,
        commitSha,
        comments: [],
        existingComments,
      }));
      core.info('No files matched the configured patterns.');
      return;
    }

    core.info(`Scanned ${stats.filesScanned} file(s)`);

    if (stats.wildcardsFound === 0) {
      logReviewCommentSyncResult(await syncReviewComments(octokit, {
        owner,
        repo,
        pullNumber,
        commitSha,
        comments: [],
        existingComments,
      }));
      core.info('No IAM wildcard actions found in the changes.');
      return;
    }

    core.info(`Found ${stats.wildcardsFound} wildcard(s), grouped into ${stats.blocksCreated} block(s)`);

    if (stats.actionsExpanded === 0) {
      logReviewCommentSyncResult(await syncReviewComments(octokit, {
        owner,
        repo,
        pullNumber,
        commitSha,
        comments: [],
        existingComments,
      }));
      core.info('No wildcard actions could be expanded.');
      return;
    }

    if (redundantActions.length > 0) {
      core.warning(`Found ${redundantActions.length} redundant action(s): ${redundantActions.join(', ')}`);
    }

    if (comments.length === 0) {
      logReviewCommentSyncResult(await syncReviewComments(octokit, {
        owner,
        repo,
        pullNumber,
        commitSha,
        comments: [],
        existingComments,
      }));
      core.info('No comments to post.');
      return;
    }

    logTruncatedComments(truncatedComments, workflowRunUrl);

    const syncResult = await syncReviewComments(octokit, {
      owner,
      repo,
      comments,
      pullNumber,
      commitSha,
      existingComments,
    });
    logReviewCommentSyncResult(syncResult);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'An unexpected error occurred');
  }
}

run();
