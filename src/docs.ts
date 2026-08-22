import { ACTION_DOC_SLUGS, SERVICE_DOC_SLUGS } from './service-doc-slugs.js';

export function getActionDocUrl(
  action: string,
  serviceDocSlugs: Readonly<Record<string, string>> = SERVICE_DOC_SLUGS,
  actionDocSlugs: Readonly<Record<string, string>> = ACTION_DOC_SLUGS,
): string | null {
  const [service, actionName] = action.split(':');
  if (!service || !actionName) return null;

  const canonicalAction = `${service.toLowerCase()}:${actionName}`;
  const slug = actionDocSlugs[canonicalAction] ?? serviceDocSlugs[service.toLowerCase()];
  if (!slug) return null;

  const encodedActionName = encodeURIComponent(actionName);
  const page = `list_${slug}`;
  const baseUrl = 'https://docs.aws.amazon.com/service-authorization/latest/reference';
  return `${baseUrl}/${page}.html#${page}-action-${encodedActionName}`;
}

export function formatActionWithLink(action: string): string {
  const url = getActionDocUrl(action);
  if (url) {
    return `[\`${action}\`](${url})`;
  }
  return `\`${action}\``;
}
