import * as core from '@actions/core';
import * as github from '@actions/github';

import { processFiles, COMMENT_MARKER } from './action.js';

type Octokit = ReturnType<typeof github.getOctokit>;

async function deleteExistingComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<number> {
  const reviewComments = await octokit.paginate(
    octokit.rest.pulls.listReviewComments,
    { owner, repo, pull_number: pullNumber, per_page: 100 }
  );

  const ourComments = reviewComments.filter((c) => c.body.includes(COMMENT_MARKER));

  for (const comment of ourComments) {
    await octokit.rest.pulls.deleteReviewComment({
      owner,
      repo,
      comment_id: comment.id,
    });
  }

  return ourComments.length;
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

    core.info(`Analyzing PR #${pullNumber} in ${owner}/${repo}`);

    const deletedCount = await deleteExistingComments(octokit, owner, repo, pullNumber);
    if (deletedCount > 0) {
      core.info(`Deleted ${deletedCount} existing comment(s) from previous runs`);
    }

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
    });

    const { comments, redundantActions, stats } = processFiles(files, filePatterns, collapseThreshold);

    if (stats.filesScanned === 0) {
      core.info('No files matched the configured patterns.');
      return;
    }

    core.info(`Scanned ${stats.filesScanned} file(s)`);

    if (stats.wildcardsFound === 0) {
      core.info('No IAM wildcard actions found in the changes.');
      return;
    }

    core.info(`Found ${stats.wildcardsFound} wildcard(s), grouped into ${stats.blocksCreated} block(s)`);

    if (stats.actionsExpanded === 0) {
      core.info('No wildcard actions could be expanded.');
      return;
    }

    if (redundantActions.length > 0) {
      core.warning(`Found ${redundantActions.length} redundant action(s): ${redundantActions.join(', ')}`);
    }

    if (comments.length === 0) {
      core.info('No comments to post.');
      return;
    }

    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      comments,
    });

    core.info(`Posted review with ${comments.length} comment(s)`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'An unexpected error occurred');
  }
}

run();
