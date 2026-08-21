import { IAM_ACTIONS } from './iam-actions.js';

export function expandIamAction(
  pattern: string,
  iamActions: readonly string[] = IAM_ACTIONS,
): string[] {
  const normalized = pattern
    .trim()
    .replace(/\u2217/g, '*')  // ∗ (unicode asterisk operator)
    .replace(/\uFF0A/g, '*')  // ＊ (fullwidth asterisk)
    .replace(/\u204E/g, '*'); // ⁎ (low asterisk)
  // Escape regex special chars except * and ?, then convert wildcards
  const regexPattern = normalized
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
