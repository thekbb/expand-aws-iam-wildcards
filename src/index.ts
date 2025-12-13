import * as core from '@actions/core';
import * as github from '@actions/github';

import type { ReviewComment, WildcardBlock } from './types.js';
import { extractFromDiff } from './diff.js';
import { groupIntoConsecutiveBlocks, formatComment, type FormatOptions } from './utils.js';
import { expandIamAction } from './expand.js';
import { matchesPatterns } from './patterns.js';

const COMMENT_MARKER = '**IAM Wildcard Expansion**';

function expandWildcards(actions: readonly string[]): Map<string, string[]> {
  const expanded = new Map<string, string[]>();

  for (const action of actions) {
    const result = expandIamAction(action);
    const isValidExpansion = result.length > 1 || (result.length === 1 && result[0] !== action);

    if (isValidExpansion) {
      expanded.set(action, result);
      core.info(`Expanded ${action} to ${result.length} actions`);
    }
  }

  return expanded;
}

function findRedundantActions(
  explicitActions: readonly string[],
  expandedActions: Map<string, string[]>,
): string[] {
  const allExpanded = new Set<string>();
  for (const actions of expandedActions.values()) {
    for (const action of actions) {
      allExpanded.add(action.toLowerCase());
    }
  }

  return explicitActions.filter((action) =>
    allExpanded.has(action.toLowerCase())
  );
}

function createReviewComments(
  blocks: readonly WildcardBlock[],
  expandedActions: Map<string, string[]>,
  redundantActions: readonly string[],
  collapseThreshold: number,
): ReviewComment[] {
  return blocks.flatMap((block) => {
    const originalActions: string[] = [];
    const allExpanded: string[] = [];

    for (const action of block.actions) {
      const expanded = expandedActions.get(action);
      if (expanded) {
        originalActions.push(action);
        allExpanded.push(...expanded);
      }
    }

    if (allExpanded.length === 0) return [];

    const uniqueExpanded = [...new Set(allExpanded)].toSorted((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    const options: FormatOptions = { collapseThreshold, redundantActions };

    return {
      path: block.file,
      line: block.endLine,
      body: formatComment(originalActions, uniqueExpanded, options),
    };
  });
}

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

    // Delete existing comments from previous runs
    const deletedCount = await deleteExistingComments(octokit, owner, repo, pullNumber);
    if (deletedCount > 0) {
      core.info(`Deleted ${deletedCount} existing comment(s) from previous runs`);
    }

    const { data: allFiles } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
    });

    const files = filePatterns.length > 0
      ? allFiles.filter((f) => matchesPatterns(f.filename, filePatterns))
      : allFiles;

    if (files.length === 0) {
      core.info('No files matched the configured patterns.');
      return;
    }

    core.info(`Scanning ${files.length} file(s) matching patterns`);

    const { wildcardMatches, explicitActions } = extractFromDiff(files);
    if (wildcardMatches.length === 0) {
      core.info('No IAM wildcard actions found in the changes.');
      return;
    }

    core.info(`Found ${wildcardMatches.length} IAM wildcard action(s)`);
    if (explicitActions.length > 0) {
      core.info(`Found ${explicitActions.length} explicit action(s)`);
    }

    const blocks = groupIntoConsecutiveBlocks(wildcardMatches);
    core.info(`Grouped into ${blocks.length} block(s)`);

    const uniqueActions = [...new Set(wildcardMatches.map((m) => m.action))];
    const expandedActions = expandWildcards(uniqueActions);
    if (expandedActions.size === 0) {
      core.info('No wildcard actions could be expanded.');
      return;
    }

    const redundantActions = findRedundantActions(explicitActions, expandedActions);
    if (redundantActions.length > 0) {
      core.warning(`Found ${redundantActions.length} redundant action(s): ${redundantActions.join(', ')}`);
    }

    const comments = createReviewComments(blocks, expandedActions, redundantActions, collapseThreshold);
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
