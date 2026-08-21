export interface IamCatalog {
  readonly actions: readonly string[];
  readonly serviceDocSlugs: Readonly<Record<string, string>>;
}

export interface IamCatalogMinimums {
  readonly actionCount: number;
  readonly serviceCount: number;
}

export const LOCKED_CATALOG_MINIMUMS: IamCatalogMinimums = {
  actionCount: 20_000,
  serviceCount: 400,
};

const ACTION_PATTERN = /^[a-z0-9][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9-]*$/;
const DOC_SLUG_PATTERN = /^[a-z0-9]+$/;

export function assertIamCatalog(
  catalog: IamCatalog,
  minimums: IamCatalogMinimums = { actionCount: 1, serviceCount: 1 },
): void {
  if (catalog.actions.length < minimums.actionCount) {
    throw new Error(
      `IAM catalog has ${catalog.actions.length} actions; expected at least ${minimums.actionCount}`,
    );
  }

  const actionSet = new Set<string>();
  const actionServices = new Set<string>();
  let previousAction: string | undefined;
  for (const action of catalog.actions) {
    if (!ACTION_PATTERN.test(action)) throw new Error(`Invalid IAM action: ${action}`);
    if (actionSet.has(action)) throw new Error(`Duplicate IAM action: ${action}`);
    if (previousAction !== undefined && previousAction > action) {
      throw new Error(`IAM actions are not sorted: ${previousAction} before ${action}`);
    }

    actionSet.add(action);
    actionServices.add(action.slice(0, action.indexOf(':')));
    previousAction = action;
  }

  const servicePrefixes = Object.keys(catalog.serviceDocSlugs);
  if (servicePrefixes.length < minimums.serviceCount) {
    throw new Error(
      `IAM catalog has ${servicePrefixes.length} services; expected at least ${minimums.serviceCount}`,
    );
  }
  const sortedServicePrefixes = [...servicePrefixes].sort();
  for (const [index, servicePrefix] of servicePrefixes.entries()) {
    if (servicePrefix !== sortedServicePrefixes[index]) {
      throw new Error(`IAM service prefixes are not sorted: ${servicePrefix}`);
    }
    const slug = catalog.serviceDocSlugs[servicePrefix];
    if (slug === undefined || !DOC_SLUG_PATTERN.test(slug)) {
      throw new Error(`Invalid IAM service documentation slug for ${servicePrefix}: ${slug ?? '<missing>'}`);
    }
    if (!actionServices.has(servicePrefix)) {
      throw new Error(`IAM service documentation has no actions: ${servicePrefix}`);
    }
  }

  for (const servicePrefix of actionServices) {
    if (!Object.hasOwn(catalog.serviceDocSlugs, servicePrefix)) {
      throw new Error(`Missing IAM service documentation slug: ${servicePrefix}`);
    }
  }
}
