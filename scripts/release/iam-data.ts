import { join, resolve } from 'node:path';

export const IAM_DATA_PACKAGE = '@cloud-copilot/iam-data';

export function installedIamDataDirectory(repositoryRoot: string): string {
  return join(resolve(repositoryRoot), 'node_modules', IAM_DATA_PACKAGE, 'data');
}
