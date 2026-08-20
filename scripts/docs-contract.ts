import { load } from 'js-yaml';

interface ActionMetadata {
  readonly inputs: Record<string, { readonly default?: unknown }>;
  readonly runs: { readonly main: string };
}

export interface DocsContractSource {
  readonly actionYaml: string;
  readonly fileExists: (path: string) => boolean;
  readonly packageJson: string;
  readonly readme: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseActionMetadata(source: string): ActionMetadata {
  const metadata: unknown = load(source);
  if (!isRecord(metadata) || !isRecord(metadata.inputs) || !isRecord(metadata.runs)) {
    throw new Error('action.yml must define inputs and runs mappings');
  }
  if (typeof metadata.runs.main !== 'string') {
    throw new Error('action.yml runs.main must be a string');
  }

  const inputs: ActionMetadata['inputs'] = {};
  for (const [name, input] of Object.entries(metadata.inputs)) {
    if (!isRecord(input)) throw new Error(`action.yml input ${name} must be a mapping`);
    inputs[name] = Object.hasOwn(input, 'default') ? { default: input.default } : {};
  }

  return {
    inputs,
    runs: { main: metadata.runs.main },
  };
}

function documentedDefaults(readme: string): Map<string, string> {
  const inputsHeading = /^## Inputs\s*$/m.exec(readme);
  if (!inputsHeading) throw new Error('README.md must contain an Inputs section');

  const section = readme.slice(inputsHeading.index + inputsHeading[0].length);
  const nextHeading = section.search(/^## /m);
  const table = (nextHeading === -1 ? section : section.slice(0, nextHeading))
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .slice(2);

  return new Map(table.map((line) => {
    const [name = '', , defaultValue = ''] = line
      .trim()
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ''));
    return [name, defaultValue];
  }));
}

function formatDefault(value: unknown): string {
  return value === undefined ? '' : String(value);
}

function collectActionUsages(value: unknown, usages: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const child of value) collectActionUsages(child, usages);
  } else if (isRecord(value)) {
    if (
      typeof value.uses === 'string' &&
      value.uses.startsWith('thekbb/expand-aws-iam-wildcards@')
    ) {
      usages.push(value);
    }
    for (const child of Object.values(value)) collectActionUsages(child, usages);
  }
}

function documentedActionUsages(readme: string): Record<string, unknown>[] {
  const usages: Record<string, unknown>[] = [];
  for (const match of readme.matchAll(/```yaml\s*\n([\s\S]*?)```/g)) {
    const example = match[1] ?? '';
    if (example.includes('thekbb/expand-aws-iam-wildcards@')) {
      collectActionUsages(load(example), usages);
    }
  }
  return usages;
}

export function validateDocsContract(source: DocsContractSource): string[] {
  let action: ActionMetadata;
  let packageMetadata: unknown;
  let defaults: Map<string, string>;
  let usages: Record<string, unknown>[];

  try {
    action = parseActionMetadata(source.actionYaml);
    packageMetadata = JSON.parse(source.packageJson);
    defaults = documentedDefaults(source.readme);
    usages = documentedActionUsages(source.readme);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const errors: string[] = [];
  for (const [name, input] of Object.entries(action.inputs)) {
    if (!defaults.has(name)) {
      errors.push(`README.md does not document action.yml input ${name}`);
    } else if (defaults.get(name) !== formatDefault(input.default)) {
      errors.push(`README.md default for ${name} does not match action.yml`);
    }
  }
  for (const name of defaults.keys()) {
    if (!Object.hasOwn(action.inputs, name)) {
      errors.push(`README.md documents unknown action input ${name}`);
    }
  }

  for (const usage of usages) {
    if (!isRecord(usage.with)) continue;
    for (const inputName of Object.keys(usage.with)) {
      if (!Object.hasOwn(action.inputs, inputName)) {
        errors.push(`README.md action example uses unknown input ${inputName}`);
      }
    }
  }

  const packageMain = isRecord(packageMetadata) ? packageMetadata.main : undefined;
  if (packageMain !== action.runs.main) {
    errors.push('package.json main does not match action.yml runs.main');
  }
  if (!source.fileExists(action.runs.main)) {
    errors.push(`action.yml runtime file does not exist: ${action.runs.main}`);
  }

  return errors;
}
