import * as core from '@actions/core';
import * as github from '@actions/github';

import { processFiles, type ProcessingStats, type TruncatedComment } from './action.js';
import {
  listActionReviewComments,
  listPullRequestFiles,
  syncReviewComments,
  type SyncReviewCommentsResult,
} from './github.js';
import { parseCollapseThreshold } from './inputs.js';

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
    `Truncated ${truncatedComments.length} review comment(s) to stay within GitHub comment limits.${logLocation}`,
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
      `Synchronized comments: ${result.createdCount} created, ${result.updatedCount} updated, ${result.unchangedCount} unchanged`,
    );
  }

  if (result.deletedCount > 0) {
    core.info(`Deleted ${result.deletedCount} existing comment(s) from previous runs`);
  }

  if (result.failedDeleteCount > 0) {
    core.warning(`Failed to delete ${result.failedDeleteCount} stale comment(s) from previous runs`);
  }

  if (result.preservedCount > 0) {
    core.info(`Preserved ${result.preservedCount} stale comment thread(s)`);
  }
}

function logDiffAnalysis(stats: ProcessingStats): void {
  const { analyzed, binary, empty, missingPatch, failed } = stats.fileAnalysis;
  const summary = [
    `${analyzed} analyzed`,
    `${binary} binary`,
    `${empty} empty`,
    `${missingPatch} missing patch`,
    `${failed} failed`,
  ].join(', ');
  core.info(`Diff analysis: ${summary}`);

  const incompleteCount = missingPatch + failed;
  if (incompleteCount > 0) {
    const incompleteSummary = `${missingPatch} missing patch, ${failed} failed`;
    const incompleteMessage =
      `Diff analysis was incomplete for ${incompleteCount} file(s): ${incompleteSummary}.`;
    core.warning(
      `${incompleteMessage} Stale comment deletion is disabled for this run.`,
    );
  }
}

export async function runAction(): Promise<void> {
  try {
    const { context } = github;

    if (!context.payload.pull_request) {
      core.info('This action only runs on pull requests. Skipping.');
      return;
    }

    const token = core.getInput('github-token', { required: true });
    const collapseThreshold = parseCollapseThreshold(core.getInput('collapse-threshold'));
    const filePatterns = core.getInput('file-patterns')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const octokit = github.getOctokit(token);
    const { owner, repo } = context.repo;
    const pullNumber = context.payload.pull_request.number as number;
    const commitSha = context.payload.pull_request.head.sha as string;
    const workflowRunUrl = getWorkflowRunUrl(owner, repo);
    const reviewCommentOptions = workflowRunUrl === undefined
      ? {}
      : { truncationUrl: workflowRunUrl };

    core.info(`Analyzing PR #${pullNumber} in ${owner}/${repo}`);

    const existingComments = await listActionReviewComments(
      octokit,
      owner,
      repo,
      pullNumber,
    );

    const files = await listPullRequestFiles(octokit, owner, repo, pullNumber);

    const { comments, stats, truncatedComments } = processFiles(
      files,
      filePatterns,
      collapseThreshold,
      reviewCommentOptions,
    );
    const incompleteAnalysisCount = stats.fileAnalysis.missingPatch
      + stats.fileAnalysis.failed;
    const syncComments = (commentsToSync: typeof comments) => syncReviewComments(octokit, {
      owner,
      repo,
      pullNumber,
      commitSha,
      comments: commentsToSync,
      existingComments,
      deleteStaleComments: incompleteAnalysisCount === 0,
    });

    if (stats.filesMatched === 0) {
      logReviewCommentSyncResult(await syncComments([]));
      core.info('No files matched the configured patterns.');
      return;
    }

    logDiffAnalysis(stats);

    if (stats.wildcardsFound === 0) {
      logReviewCommentSyncResult(await syncComments([]));
      core.info('No IAM wildcard actions found in the analyzed files.');
      return;
    }

    core.info(`Found ${stats.wildcardsFound} wildcard(s), grouped into ${stats.blocksCreated} block(s)`);

    if (stats.actionsExpanded === 0) {
      logReviewCommentSyncResult(await syncComments([]));
      core.info('No wildcard actions could be expanded.');
      return;
    }

    if (comments.length === 0) {
      logReviewCommentSyncResult(await syncComments([]));
      core.info('No comments to post.');
      return;
    }

    logTruncatedComments(truncatedComments, workflowRunUrl);

    const syncResult = await syncComments(comments);
    logReviewCommentSyncResult(syncResult);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'An unexpected error occurred');
  }
}
