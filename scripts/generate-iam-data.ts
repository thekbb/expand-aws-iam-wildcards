/**
 * Generates static IAM action and service-doc metadata at build time.
 * Run with: npm run generate-iam-data
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

interface IamDataAction {
  readonly name: string;
}

const dataDir = join(process.cwd(), 'node_modules/@cloud-copilot/iam-data/data');
const actionsDir = join(dataDir, 'actions');
const serviceNamesPath = join(dataDir, 'serviceNames.json');

// Most AWS Service Authorization page slugs are just normalized service names.
// These overrides cover the legacy docs paths that still do not follow that rule.
const DOC_SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  'glacier': 's3glacier',
  'elasticloadbalancing': 'elasticloadbalancing',
  'apigateway': 'amazonapigateway',
  'sso': 'awsiamidentitycentersuccessortoawssinglesignon',
  'cloudformation': 'awscloudformation',
  'kinesis': 'amazonkinesis',
  'es': 'amazonelasticsearchservice',
  'opensearch': 'amazonopensearchservice',
  'application-autoscaling': 'applicationautoscaling',
  'pricing': 'awspricelistservice',
};

function normalizeServiceName(serviceName: string): string {
  return serviceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function readServicePrefixes(): string[] {
  return readdirSync(actionsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace('.json', ''))
    .sort();
}

function readAllActions(servicePrefixes: readonly string[]): string[] {
  return servicePrefixes
    .flatMap((servicePrefix) => {
      const filePath = join(actionsDir, `${servicePrefix}.json`);
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, IamDataAction>;

      return Object.values(data)
        .map((action) => `${servicePrefix}:${action.name}`);
    })
    .sort();
}

function generateServiceDocSlugs(
  servicePrefixes: readonly string[],
  serviceNames: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    servicePrefixes.map((servicePrefix) => {
      const serviceName = serviceNames[servicePrefix];
      if (!serviceName) {
        throw new Error(`Missing service name metadata for IAM service prefix: ${servicePrefix}`);
      }

      return [
        servicePrefix,
        DOC_SLUG_OVERRIDES[servicePrefix] ?? normalizeServiceName(serviceName),
      ];
    }),
  );
}

const servicePrefixes = readServicePrefixes();
const allActions = readAllActions(servicePrefixes);
const serviceNames = JSON.parse(
  readFileSync(serviceNamesPath, 'utf-8'),
) as Record<string, string>;
const serviceDocSlugs = generateServiceDocSlugs(servicePrefixes, serviceNames);

const actionsOutput = `// Auto-generated - do not edit
// Run: npm run generate-iam-data

export const IAM_ACTIONS: readonly string[] = ${JSON.stringify(allActions, null, 2)};
`;

const serviceDocSlugsOutput = `// Auto-generated - do not edit
// Run: npm run generate-iam-data

export const SERVICE_DOC_SLUGS: Readonly<Record<string, string>> = ${JSON.stringify(serviceDocSlugs, null, 2)};
`;

writeFileSync(join(process.cwd(), 'src/iam-actions.ts'), actionsOutput);
writeFileSync(join(process.cwd(), 'src/service-doc-slugs.ts'), serviceDocSlugsOutput);

console.log(`Generated ${allActions.length} IAM actions and ${servicePrefixes.length} service doc slugs`);
