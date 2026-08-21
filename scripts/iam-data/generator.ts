import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

interface IamDataAction {
  readonly name: string;
}

export interface GenerateIamDataOptions {
  readonly dataDirectory: string;
  readonly outputDirectory: string;
  readonly repositoryRoot: string;
}

export interface IamDataGenerationResult {
  readonly actionCount: number;
  readonly serviceCount: number;
}

const DOC_SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  glacier: 's3glacier',
  elasticloadbalancing: 'elasticloadbalancing',
  apigateway: 'amazonapigateway',
  sso: 'awsiamidentitycentersuccessortoawssinglesignon',
  cloudformation: 'awscloudformation',
  kinesis: 'amazonkinesis',
  es: 'amazonelasticsearchservice',
  opensearch: 'amazonopensearchservice',
  'application-autoscaling': 'applicationautoscaling',
  pricing: 'awspricelistservice',
};

function normalizeServiceName(serviceName: string): string {
  return serviceName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isDescendant(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function validateGeneratorOutputDirectory(
  repositoryRoot: string,
  outputDirectory: string,
): string {
  const resolvedRepository = resolve(repositoryRoot);
  const resolvedOutput = resolve(outputDirectory);
  const resolvedTemporaryDirectory = resolve(tmpdir());

  if (
    !isDescendant(resolvedRepository, resolvedOutput) &&
    !isDescendant(resolvedTemporaryDirectory, resolvedOutput)
  ) {
    throw new Error('IAM data output must be inside the repository or temporary directory');
  }

  if (existsSync(resolvedOutput)) {
    const status = lstatSync(resolvedOutput);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(`IAM data output must be a regular directory: ${resolvedOutput}`);
    }
  }

  return resolvedOutput;
}

function readServicePrefixes(actionsDirectory: string): string[] {
  return readdirSync(actionsDirectory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
}

function readAllActions(actionsDirectory: string, servicePrefixes: readonly string[]): string[] {
  return servicePrefixes
    .flatMap((servicePrefix) => {
      const filePath = join(actionsDirectory, `${servicePrefix}.json`);
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, IamDataAction>;
      return Object.values(data).map((action) => `${servicePrefix}:${action.name}`);
    })
    .sort();
}

function generateServiceDocSlugs(
  servicePrefixes: readonly string[],
  serviceNames: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(servicePrefixes.map((servicePrefix) => {
    const serviceName = serviceNames[servicePrefix];
    if (!serviceName) {
      throw new Error(`Missing service name metadata for IAM service prefix: ${servicePrefix}`);
    }
    return [
      servicePrefix,
      DOC_SLUG_OVERRIDES[servicePrefix] ?? normalizeServiceName(serviceName),
    ];
  }));
}

function validateOutputFiles(paths: readonly string[]): void {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const status = lstatSync(path);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new Error(`IAM data output file must be a regular file: ${path}`);
    }
  }
}

export function generateIamData(options: GenerateIamDataOptions): IamDataGenerationResult {
  const dataDirectory = resolve(options.dataDirectory);
  const actionsDirectory = join(dataDirectory, 'actions');
  const serviceNamesPath = join(dataDirectory, 'serviceNames.json');
  const outputDirectory = validateGeneratorOutputDirectory(
    options.repositoryRoot,
    options.outputDirectory,
  );

  const servicePrefixes = readServicePrefixes(actionsDirectory);
  const allActions = readAllActions(actionsDirectory, servicePrefixes);
  const serviceNames = JSON.parse(readFileSync(serviceNamesPath, 'utf8')) as Record<string, string>;
  const serviceDocSlugs = generateServiceDocSlugs(servicePrefixes, serviceNames);
  const actionsOutputPath = join(outputDirectory, 'iam-actions.ts');
  const serviceDocSlugsOutputPath = join(outputDirectory, 'service-doc-slugs.ts');

  const actionsOutput = `// Auto-generated - do not edit
// Run: npm run generate-iam-data

export const IAM_ACTIONS: readonly string[] = ${JSON.stringify(allActions, null, 2)};
`;
  const serviceDocSlugsOutput = `// Auto-generated - do not edit
// Run: npm run generate-iam-data

export const SERVICE_DOC_SLUGS: Readonly<Record<string, string>> = ${JSON.stringify(serviceDocSlugs, null, 2)};
`;

  mkdirSync(outputDirectory, { recursive: true });
  validateOutputFiles([actionsOutputPath, serviceDocSlugsOutputPath]);
  writeFileSync(actionsOutputPath, actionsOutput, 'utf8');
  writeFileSync(serviceDocSlugsOutputPath, serviceDocSlugsOutput, 'utf8');

  return {
    actionCount: allActions.length,
    serviceCount: servicePrefixes.length,
  };
}
