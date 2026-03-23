import { describe, expect, it, vi } from 'vitest';

import { listPullRequestFiles } from './github.js';
import type { PullRequestFile } from './types.js';

describe('listPullRequestFiles', () => {
  it('paginates pull request files with a page size of 100', async () => {
    const files: PullRequestFile[] = [
      { filename: 'policy-1.tf', patch: '+ "s3:Get*"' },
      { filename: 'policy-2.tf', patch: '+ "ec2:Describe*"' },
    ];
    const listFiles = {};
    const paginate = vi.fn().mockResolvedValue(files);
    const octokit = {
      paginate,
      rest: {
        pulls: {
          listFiles,
        },
      },
    };

    const result = await listPullRequestFiles(octokit, 'thekbb', 'expand-aws-iam-wildcards', 42);

    expect(result).toEqual(files);
    expect(paginate).toHaveBeenCalledWith(listFiles, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pull_number: 42,
      per_page: 100,
    });
  });
});
