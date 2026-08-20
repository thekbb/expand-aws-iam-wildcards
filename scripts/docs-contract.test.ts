import { describe, expect, it } from 'vitest';

import { validateDocsContract, type DocsContractSource } from './docs-contract.js';

const actionYaml = `
inputs:
  github-token:
    default: \${{ github.token }}
  file-patterns:
    default: '**/*.tf'
runs:
  using: node24
  main: dist/index.js
`;

const readme = `
## Inputs

| Name | Description | Default |
| --- | --- | --- |
| \`github-token\` | GitHub token | \`\${{ github.token }}\` |
| \`file-patterns\` | File patterns | \`**/*.tf\` |

## Example

\`\`\`yaml
- uses: thekbb/expand-aws-iam-wildcards@v1
  with:
    file-patterns: '**/*.tf'
\`\`\`
`;

function source(overrides: Partial<DocsContractSource> = {}): DocsContractSource {
  return {
    actionYaml,
    fileExists: (path) => path === 'dist/index.js',
    packageJson: '{"main":"dist/index.js"}',
    readme,
    ...overrides,
  };
}

describe('validateDocsContract', () => {
  it('accepts aligned action documentation', () => {
    expect(validateDocsContract(source())).toEqual([]);
  });

  it('reports missing, unknown, and stale input defaults', () => {
    const staleReadme = readme
      .replace('| `github-token` | GitHub token | `${{ github.token }}` |\n', '')
      .replace('`file-patterns`', '`old-patterns`');

    expect(validateDocsContract(source({ readme: staleReadme }))).toEqual(expect.arrayContaining([
      'README.md does not document action.yml input github-token',
      'README.md does not document action.yml input file-patterns',
      'README.md documents unknown action input old-patterns',
    ]));

    const staleDefault = readme.replace('`**/*.tf` |', '`**/*.json` |');
    expect(validateDocsContract(source({ readme: staleDefault }))).toContain(
      'README.md default for file-patterns does not match action.yml',
    );
  });

  it('reports unknown inputs in action examples', () => {
    const staleReadme = readme.replace("file-patterns: '**/*.tf'", "unknown-input: 'value'");

    expect(validateDocsContract(source({ readme: staleReadme }))).toContain(
      'README.md action example uses unknown input unknown-input',
    );
  });

  it('reports runtime metadata drift and a missing runtime', () => {
    expect(validateDocsContract(source({
      fileExists: () => false,
      packageJson: '{"main":"dist/old.js"}',
    }))).toEqual(expect.arrayContaining([
      'package.json main does not match action.yml runs.main',
      'action.yml runtime file does not exist: dist/index.js',
    ]));
  });

  it('reports malformed metadata and documentation', () => {
    expect(validateDocsContract(source({ actionYaml: 'name: invalid' }))).toEqual([
      'action.yml must define inputs and runs mappings',
    ]);
    expect(validateDocsContract(source({ readme: '# No inputs' }))).toEqual([
      'README.md must contain an Inputs section',
    ]);
  });
});
