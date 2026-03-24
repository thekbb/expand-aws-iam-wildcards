import { SERVICE_DOC_SLUGS } from './service-doc-slugs.js';

export function getActionDocUrl(action: string): string | null {
  const [service, actionName] = action.split(':');
  if (!service || !actionName) return null;

  const slug = SERVICE_DOC_SLUGS[service.toLowerCase()];
  if (!slug) return null;

  // Use text fragment only; avoids some pages overriding section hash navigation.
  const encodedActionName = encodeURIComponent(actionName);
  return `https://docs.aws.amazon.com/service-authorization/latest/reference/list_${slug}.html#:~:text=${encodedActionName}`;
}

export function formatActionWithLink(action: string): string {
  const url = getActionDocUrl(action);
  if (url) {
    return `[\`${action}\`](${url})`;
  }
  return `\`${action}\``;
}
