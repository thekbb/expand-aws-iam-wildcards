import { IAM_ACTIONS } from './iam-actions.js';

export function expandIamAction(
  pattern: string,
  iamActions: readonly string[] = IAM_ACTIONS,
): string[] {
  const trimmedPattern = pattern.trim();
  // Escape regex special chars except * and ?, then convert wildcards
  const regexPattern = trimmedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  try {
    const regex = new RegExp('^' + regexPattern + '$', 'i');
    return iamActions.filter((action) => regex.test(action));
  } catch {
    return [];
  }
}
