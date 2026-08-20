import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createReviewComments,
  processFiles,
  type ProcessingStats,
} from './action.js';
import { parseCollapseThreshold } from './inputs.js';
import { syncReviewComments, type SyncReviewCommentsResult } from './github.js';
import type {
  PullRequestFile,
  PullRequestReviewComment,
  ReviewComment,
  WildcardBlock,
  WildcardMatch,
} from './types.js';
import { formatCommentResult, groupIntoConsecutiveBlocks } from './utils.js';

const fixtureRoot = new URL('../fixtures/compatibility/', import.meta.url);

function readTextFixture(name: string): string {
  return readFileSync(new URL(name, fixtureRoot), 'utf8').trimEnd();
}

function readJsonFixture<T>(name: string): T {
  return JSON.parse(readTextFixture(name)) as T;
}

interface ProcessingFixture {
  readonly files: PullRequestFile[];
  readonly filePatterns: string[];
  readonly collapseThreshold: number;
  readonly expectedStats: ProcessingStats;
  readonly expectedPath: string;
  readonly expectedLine: number;
}

interface GroupedCommentFixture {
  readonly matches: WildcardMatch[];
  readonly expandedActions: [string, string[]][];
  readonly collapseThreshold: number;
  readonly expectedBlock: WildcardBlock;
}

interface TruncatedCommentFixture {
  readonly originalActions: string[];
  readonly expandedActions: string[];
  readonly maxCommentBodyLength: number;
  readonly truncationUrl: string;
}

interface NoOpFixture {
  readonly name: string;
  readonly files: PullRequestFile[];
  readonly filePatterns: string[];
  readonly expectedStats: ProcessingStats;
}

interface InvalidInputFixture {
  readonly input: string;
  readonly message: string;
}

interface ReviewSyncFixture {
  readonly name: string;
  readonly comments: ReviewComment[];
  readonly existingComments: PullRequestReviewComment[];
  readonly expectedResult: SyncReviewCommentsResult;
  readonly expectedUpdatedIds: number[];
  readonly expectedDeletedIds: number[];
  readonly expectedCreatedComments: ReviewComment[];
}

interface CreateReviewParameters {
  readonly owner: string;
  readonly repo: string;
  readonly pull_number: number;
  readonly commit_id: string;
  readonly event: 'COMMENT';
  readonly comments: ReviewComment[];
}

interface UpdateReviewCommentParameters {
  readonly owner: string;
  readonly repo: string;
  readonly comment_id: number;
  readonly body: string;
}

interface DeleteReviewCommentParameters {
  readonly owner: string;
  readonly repo: string;
  readonly comment_id: number;
}

describe('runtime compatibility fixtures', () => {
  it('preserves diff discovery, IAM expansion, links, and exact comment rendering', () => {
    const fixture = readJsonFixture<ProcessingFixture>('s3-get-tagging.json');
    const expectedBody = readTextFixture('s3-get-tagging-comment.txt');

    const result = processFiles(
      fixture.files,
      fixture.filePatterns,
      fixture.collapseThreshold,
    );

    expect(result).toEqual({
      comments: [{
        path: fixture.expectedPath,
        line: fixture.expectedLine,
        body: expectedBody,
      }],
      stats: fixture.expectedStats,
      truncatedComments: [],
    });
  });

  it('preserves grouping, deduplication, sorting, collapsing, and exact Markdown', () => {
    const fixture = readJsonFixture<GroupedCommentFixture>('grouped-comment.json');
    const expectedBody = readTextFixture('grouped-comment.txt');

    const blocks = groupIntoConsecutiveBlocks(fixture.matches);
    expect(blocks).toEqual([fixture.expectedBlock]);

    const comments = createReviewComments(
      blocks,
      new Map(fixture.expandedActions),
      fixture.collapseThreshold,
    );

    expect(comments).toEqual([{
      path: fixture.expectedBlock.file,
      line: fixture.expectedBlock.endLine,
      body: expectedBody,
    }]);
  });

  it('preserves the minimal truncation fallback and workflow log link', () => {
    const fixture = readJsonFixture<TruncatedCommentFixture>('minimal-truncated-comment.json');
    const expectedBody = readTextFixture('minimal-truncated-comment.txt');

    expect(formatCommentResult(
      fixture.originalActions,
      fixture.expandedActions,
      {
        maxCommentBodyLength: fixture.maxCommentBodyLength,
        truncationUrl: fixture.truncationUrl,
      },
    )).toEqual({
      body: expectedBody,
      renderedActionsCount: 0,
      truncated: true,
    });
  });

  const noOpFixtures = readJsonFixture<NoOpFixture[]>('no-op-scenarios.json');

  it.each(noOpFixtures)('preserves the $name no-op result', (fixture) => {
    expect(processFiles(fixture.files, fixture.filePatterns, 5)).toEqual({
      comments: [],
      stats: fixture.expectedStats,
      truncatedComments: [],
    });
  });

  const invalidInputFixtures = readJsonFixture<InvalidInputFixture[]>('invalid-inputs.json');

  it.each(invalidInputFixtures)('preserves the failure for collapse-threshold $input', (fixture) => {
    expect(() => parseCollapseThreshold(fixture.input)).toThrow(fixture.message);
  });

  const reviewSyncFixtures = readJsonFixture<ReviewSyncFixture[]>('review-sync-scenarios.json');

  it.each(reviewSyncFixtures)('preserves review synchronization when it $name', async (fixture) => {
    const createdComments: ReviewComment[] = [];
    const updatedIds: number[] = [];
    const deletedIds: number[] = [];
    const octokit = {
      rest: {
        pulls: {
          createReview: (parameters: CreateReviewParameters) => {
            createdComments.push(...parameters.comments);
            return Promise.resolve({});
          },
          updateReviewComment: (parameters: UpdateReviewCommentParameters) => {
            updatedIds.push(parameters.comment_id);
            return Promise.resolve({});
          },
          deleteReviewComment: (parameters: DeleteReviewCommentParameters) => {
            deletedIds.push(parameters.comment_id);
            return Promise.resolve({});
          },
        },
      },
    };

    const result = await syncReviewComments(octokit, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 42,
      commitSha: 'deadbeefcafebabe',
      comments: fixture.comments,
      existingComments: fixture.existingComments,
    });

    expect(result).toEqual(fixture.expectedResult);
    expect(updatedIds).toEqual(fixture.expectedUpdatedIds);
    expect(deletedIds).toEqual(fixture.expectedDeletedIds);
    expect(createdComments).toEqual(fixture.expectedCreatedComments);
  });
});
