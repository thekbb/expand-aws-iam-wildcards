// Maps IAM service prefixes to their Service Authorization Reference page slugs
const SERVICE_DOC_SLUGS: Record<string, string> = {
  // Compute
  'ec2': 'amazonec2',
  'lambda': 'awslambda',
  'ecs': 'amazonelasticcontainerservice',
  'eks': 'amazonelastickubernetesservice',
  'batch': 'awsbatch',
  'lightsail': 'amazonlightsail',
  'elasticbeanstalk': 'awselasticbeanstalk',

  // Storage
  's3': 'amazons3',
  's3-object-lambda': 'amazons3objectlambda',
  'ebs': 'amazonelasticblockstore',
  'efs': 'amazonelasticfilesystem',
  'glacier': 's3glacier',
  'backup': 'awsbackup',

  // Database
  'dynamodb': 'amazondynamodb',
  'rds': 'amazonrds',
  'redshift': 'amazonredshift',
  'elasticache': 'amazonelasticache',
  'neptune-db': 'amazonneptune',
  'docdb-elastic': 'amazondocumentdbelasticclusters',

  // Networking
  'elasticloadbalancing': 'elasticloadbalancing',
  'route53': 'amazonroute53',
  'cloudfront': 'amazoncloudfront',
  'apigateway': 'amazonapigateway',
  'vpc': 'amazonvpc',

  // Security & Identity
  'iam': 'awsidentityandaccessmanagementiam',
  'sts': 'awssecuritytokenservice',
  'kms': 'awskeymanagementservice',
  'secretsmanager': 'awssecretsmanager',
  'acm': 'awscertificatemanager',
  'cognito-idp': 'amazoncognitouserpools',
  'cognito-identity': 'amazoncognitoidentity',
  'sso': 'awsiamidentitycentersuccessortoawssinglesignon',

  // Management & Governance
  'cloudwatch': 'amazoncloudwatch',
  'logs': 'amazoncloudwatchlogs',
  'events': 'amazoneventbridge',
  'cloudtrail': 'awscloudtrail',
  'config': 'awsconfig',
  'ssm': 'awssystemsmanager',
  'organizations': 'awsorganizations',
  'cloudformation': 'awscloudformation',

  // Application Integration
  'sns': 'amazonsns',
  'sqs': 'amazonsqs',
  'states': 'awsstepfunctions',
  'mq': 'amazonmq',

  // Analytics
  'athena': 'amazonathena',
  'glue': 'awsglue',
  'kinesis': 'amazonkinesis',
  'firehose': 'amazonkinesisfirehose',
  'es': 'amazonelasticsearchservice',
  'opensearch': 'amazonopensearchservice',

  // Machine Learning
  'sagemaker': 'amazonsagemaker',
  'bedrock': 'amazonbedrock',
  'comprehend': 'amazoncomprehend',
  'rekognition': 'amazonrekognition',
  'textract': 'amazontextract',
  'translate': 'amazontranslate',

  // Developer Tools
  'codebuild': 'awscodebuild',
  'codecommit': 'awscodecommit',
  'codedeploy': 'awscodedeploy',
  'codepipeline': 'awscodepipeline',
  'codestar': 'awscodestar',

  // Containers
  'ecr': 'amazonelasticcontainerregistry',

  // Other common services
  'autoscaling': 'amazonec2autoscaling',
  'application-autoscaling': 'applicationautoscaling',
  'servicecatalog': 'awsservicecatalog',
  'resource-groups': 'awsresourcegroups',
  'tag': 'amazonresourcegrouptaggingapi',
  'access-analyzer': 'awsiamaccessanalyzer',
  'health': 'awshealthapisandnotifications',
  'support': 'awssupport',
  'pricing': 'awspricelistservice',
  'ce': 'awscostexplorerservice',
  'budgets': 'awsbudgetservice',
  'cur': 'awscostandusagereport',
};

export function getActionDocUrl(action: string): string | null {
  const [service, actionName] = action.split(':');
  if (!service || !actionName) return null;

  const slug = SERVICE_DOC_SLUGS[service.toLowerCase()];
  if (!slug) return null;

  // Use text fragment to highlight the action
  return `https://docs.aws.amazon.com/service-authorization/latest/reference/list_${slug}.html#${slug}-actions-as-permissions:~:text=${actionName}`;
}

export function formatActionWithLink(action: string): string {
  const url = getActionDocUrl(action);
  if (url) {
    return `[${action}](${url})`;
  }
  return `"${action}"`;
}
