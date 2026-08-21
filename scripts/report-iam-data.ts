import { resolve } from 'node:path';

import {
  createIamDataReport,
  writeIamDataReport,
} from './release/iam-data-report.js';

try {
  const report = createIamDataReport(resolve(import.meta.dirname, '..'));
  writeIamDataReport(report, {
    ...(process.env.GITHUB_OUTPUT === undefined
      ? {}
      : { githubOutputPath: process.env.GITHUB_OUTPUT }),
    ...(process.env.GITHUB_STEP_SUMMARY === undefined
      ? {}
      : { githubSummaryPath: process.env.GITHUB_STEP_SUMMARY }),
  });
  console.log(
    `Using @cloud-copilot/iam-data ${report.version}: ` +
    `${report.actionCount} actions across ${report.serviceCount} services.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
