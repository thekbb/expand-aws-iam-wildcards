/**
 * Generates a static list of all IAM actions at build time.
 * Run with: npm run generate-iam-data
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const actionsDir = join(
  process.cwd(),
  'node_modules/@cloud-copilot/iam-data/data/actions'
);

const allActions: string[] = [];

for (const file of readdirSync(actionsDir)) {
  if (!file.endsWith('.json')) continue;

  const serviceName = file.replace('.json', '');
  const data = JSON.parse(readFileSync(join(actionsDir, file), 'utf-8'));

  for (const action of Object.keys(data)) {
    allActions.push(`${serviceName}:${action}`);
  }
}

allActions.sort();

const output = `// Auto-generated - do not edit
// Run: npm run generate-iam-data

export const IAM_ACTIONS: readonly string[] = ${JSON.stringify(allActions, null, 2)};
`;

writeFileSync(join(process.cwd(), 'src/iam-actions.ts'), output);

console.log(`Generated ${allActions.length} IAM actions`);
