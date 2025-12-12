import { IAM_ACTIONS } from './iam-actions.js';

export function expandIamAction(pattern: string): string[] {
  // Escape regex special chars except * and ?, then convert wildcards
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  try {
    const regex = new RegExp('^' + regexPattern + '$', 'i');
    return IAM_ACTIONS.filter((action) => regex.test(action));
  } catch {
    return [];
  }
}
