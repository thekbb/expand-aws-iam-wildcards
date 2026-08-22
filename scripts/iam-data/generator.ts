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

import {
  assertIamCatalog,
  type IamCatalog,
  type IamCatalogMinimums,
} from './catalog.js';
import { ACTION_DOC_PAGE_OVERRIDES } from './doc-page-overrides.js';

interface IamDataAction {
  readonly name: string;
}

export interface GenerateIamDataOptions {
  readonly dataDirectory: string;
  readonly outputDirectory: string;
  readonly repositoryRoot: string;
  readonly minimums?: IamCatalogMinimums;
}

export interface IamDataGenerationResult {
  readonly actionCount: number;
  readonly serviceCount: number;
}

type DocPageOverride = readonly [serviceName: string, slug: string];

// AWS normally uses the IAM service prefix as its authorization-reference page
// slug. These current pages are the documented exceptions. Keep the expected
// service name beside each slug so an IAM-data update cannot silently select a
// different AWS page that shares the same IAM prefix.
const DOC_PAGE_OVERRIDES: Readonly<Record<string, DocPageOverride>> = {
  'access-analyzer': ['AWS IAM Access Analyzer', 'accessanalyzer'],
  'aco-automation': ['AWS Compute Optimizer Automation', 'compute-optimizer-automation'],
  aidevops: ['AWS DevOps Agent Service', 'devops-agent'],
  airflow: ['Amazon Managed Workflows for Apache Airflow', 'mwaa'],
  'airflow-serverless': ['AWS MWAA Serverless', 'mwaa-serverless'],
  aoss: ['Amazon OpenSearch Serverless', 'opensearchserverless'],
  apigateway: ['Amazon API Gateway Management V2', 'apigatewayv2'],
  'app-integrations': ['Amazon AppIntegrations', 'appintegrations'],
  applicationinsights: ['Amazon CloudWatch Application Insights', 'application-insights'],
  aps: ['Amazon Managed Service for Prometheus', 'amp'],
  'aws-marketplace': ['AWS Marketplace Catalog', 'marketplace-catalog'],
  'backup-search': ['AWS Backup Search', 'backupsearch'],
  cases: ['Amazon Connect Cases', 'connectcases'],
  cassandra: ['Amazon Keyspaces (for Apache Cassandra)', 'keyspaces'],
  'cleanrooms-ml': ['AWS Clean Rooms ML', 'cleanroomsml'],
  cloudformation: ['AWS Cloud Control API', 'cloudcontrol'],
  'codeguru-profiler': ['Amazon CodeGuru Profiler', 'codeguruprofiler'],
  'connect-campaigns': ['Amazon Connect Outbound Campaigns', 'connect-outbound-campaigns'],
  elasticfilesystem: ['Amazon Elastic File System', 'efs'],
  elasticloadbalancing: ['AWS Elastic Load Balancing V2', 'elbv2'],
  elasticmapreduce: ['Amazon Elastic MapReduce', 'emr'],
  'elemental-inference': ['AWS Elemental Inference', 'elementalinference'],
  'execute-api': ['Amazon API Gateway', 'apigatewaymanagementapi'],
  'finspace-api': ['Amazon FinSpace API', 'finspace-data'],
  geo: ['Amazon Location', 'location'],
  greengrass: ['AWS IoT Greengrass V2', 'greengrassv2'],
  'health-agent': ['Amazon Connect Health', 'connecthealth'],
  iotjobsdata: ['AWS IoT Jobs DataPlane', 'iot-jobs-data'],
  iotmanagedintegrations: ['AWS IoT Managed Integrations', 'iot-managed-integrations'],
  ivs: ['Amazon Interactive Video Service', 'interactive-video-service'],
  kinesisanalytics: ['Amazon Kinesis Analytics V2', 'kinesisanalyticsv2'],
  kinesisvideo: ['Amazon Kinesis Video Streams', 'kinesis-video-streams'],
  launchwizard: ['AWS Launch Wizard', 'launch-wizard'],
  lex: ['Amazon Lex V2', 'lex-v2'],
  mechanicalturk: ['Amazon Mechanical Turk', 'mturk'],
  mgh: ['AWS Migration Hub', 'migration-hub'],
  'migrationhub-orchestrator': ['AWS Migration Hub Orchestrator', 'migrationhuborchestrator'],
  'migrationhub-strategy': ['AWS Migration Hub Strategy Recommendations', 'migrationhubstrategy'],
  mobiletargeting: ['Amazon Pinpoint', 'pinpoint'],
  'neptune-db': ['Amazon Neptune', 'neptunedata'],
  'notifications-contacts': ['AWS User Notifications Contacts', 'notificationscontacts'],
  partnercentral: ['AWS Partner Central', 'partner-central'],
  pricingplanmanager: ['AWS PricingPlanManager Service', 'pricing-plan-manager'],
  profile: ['Amazon Connect Customer Profiles', 'customer-profiles'],
  'refactor-spaces': ['AWS Migration Hub Refactor Spaces', 'migration-hub-refactor-spaces'],
  resiliencehub: ['AWS Resilience Hub', 'resilience-hub'],
  's3-outposts': ['Amazon S3 on Outposts', 's3outposts'],
  scn: ['AWS Supply Chain', 'supplychain'],
  sdb: ['Amazon SimpleDB', 'simpledb'],
  servicecatalog: ['AWS Service Catalog', 'service-catalog'],
  servicequotas: ['Service Quotas', 'service-quotas'],
  ses: ['Amazon Pinpoint Email Service', 'pinpoint-email'],
  'sms-voice': ['AWS End User Messaging SMS and Voice V2', 'pinpoint-sms-voice-v2'],
  'social-messaging': ['AWS End User Messaging Social', 'socialmessaging'],
  sso: ['AWS IAM Identity Center', 'iam-identity-center'],
  'sso-oauth': ['AWS IAM Identity Center OIDC service', 'sso-oidc'],
  states: ['AWS Step Functions', 'stepfunctions'],
  supportapp: ['AWS Support App in Slack', 'support-app'],
  tag: ['Amazon Resource Group Tagging API', 'resourcegroupstaggingapi'],
  tax: ['AWS Tax Settings', 'taxsettings'],
  thinclient: ['Amazon WorkSpaces Thin Client', 'workspaces-thin-client'],
  voiceid: ['Amazon Connect Voice ID', 'voice-id'],
  wisdom: ['Amazon Q in Connect', 'q-in-connect'],
};

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
    const override = DOC_PAGE_OVERRIDES[servicePrefix];
    if (override !== undefined && override[0] !== serviceName) {
      throw new Error(
        `IAM documentation page override for ${servicePrefix} expects ${override[0]}, got ${serviceName}`,
      );
    }
    return [servicePrefix, override?.[1] ?? servicePrefix];
  }));
}

function generateActionDocSlugs(servicePrefixes: readonly string[]): Record<string, string> {
  const services = new Set(servicePrefixes);
  return Object.fromEntries(Object.entries(ACTION_DOC_PAGE_OVERRIDES)
    .filter(([action]) => services.has(action.slice(0, action.indexOf(':'))))
    .sort(([left], [right]) => (left < right ? -1 : 1)));
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

export function readIamCatalog(
  dataDirectory: string,
  minimums?: IamCatalogMinimums,
): IamCatalog {
  const resolvedDataDirectory = resolve(dataDirectory);
  const actionsDirectory = join(resolvedDataDirectory, 'actions');
  const serviceNamesPath = join(resolvedDataDirectory, 'serviceNames.json');
  const servicePrefixes = readServicePrefixes(actionsDirectory);
  const actions = readAllActions(actionsDirectory, servicePrefixes);
  const serviceNames = JSON.parse(readFileSync(serviceNamesPath, 'utf8')) as Record<string, string>;
  const serviceDocSlugs = generateServiceDocSlugs(servicePrefixes, serviceNames);
  const actionDocSlugs = generateActionDocSlugs(servicePrefixes);
  const catalog = { actions, actionDocSlugs, serviceDocSlugs };
  assertIamCatalog(catalog, minimums);
  return catalog;
}

export function generateIamData(options: GenerateIamDataOptions): IamDataGenerationResult {
  const dataDirectory = resolve(options.dataDirectory);
  const outputDirectory = validateGeneratorOutputDirectory(
    options.repositoryRoot,
    options.outputDirectory,
  );

  const catalog = readIamCatalog(dataDirectory, options.minimums);
  const actionsOutputPath = join(outputDirectory, 'iam-actions.ts');
  const serviceDocSlugsOutputPath = join(outputDirectory, 'service-doc-slugs.ts');

  const actionsOutput = `// Auto-generated - do not edit
// Run: npm run generate-iam-data

export const IAM_ACTIONS: readonly string[] = ${JSON.stringify(catalog.actions, null, 2)};
`;
  const serviceDocSlugsOutput = `// Auto-generated - do not edit
// Run: npm run generate-iam-data

export const SERVICE_DOC_SLUGS: Readonly<Record<string, string>> = ${JSON.stringify(catalog.serviceDocSlugs, null, 2)};

export const ACTION_DOC_SLUGS: Readonly<Record<string, string>> = ${JSON.stringify(catalog.actionDocSlugs, null, 2)};
`;

  mkdirSync(outputDirectory, { recursive: true });
  validateOutputFiles([actionsOutputPath, serviceDocSlugsOutputPath]);
  writeFileSync(actionsOutputPath, actionsOutput, 'utf8');
  writeFileSync(serviceDocSlugsOutputPath, serviceDocSlugsOutput, 'utf8');

  return {
    actionCount: catalog.actions.length,
    serviceCount: Object.keys(catalog.serviceDocSlugs).length,
  };
}
