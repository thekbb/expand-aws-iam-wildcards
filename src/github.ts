import type { PullRequestFile } from './types.js';

interface PullRequestFilesClient {
  readonly paginate: (
    route: unknown,
    parameters: {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
    },
  ) => Promise<PullRequestFile[]>;
  readonly rest: {
    readonly pulls: {
      readonly listFiles: unknown;
    };
  };
}

export async function listPullRequestFiles(
  octokit: PullRequestFilesClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestFile[]> {
  return octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
}
