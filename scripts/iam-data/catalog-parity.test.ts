import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getActionDocUrl } from '../../src/docs.js';
import { expandIamAction } from '../../src/expand.js';
import { IAM_ACTIONS } from '../../src/iam-actions.js';
import { SERVICE_DOC_SLUGS } from '../../src/service-doc-slugs.js';
import { assertIamCatalog, LOCKED_CATALOG_MINIMUMS } from './catalog.js';
import { readIamCatalog } from './generator.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const lockedCatalog = readIamCatalog(
  resolve(repositoryRoot, 'node_modules/@cloud-copilot/iam-data/data'),
);
const generatedSourceCatalog = {
  actions: IAM_ACTIONS,
  serviceDocSlugs: SERVICE_DOC_SLUGS,
};

describe('generated IAM source catalog parity', () => {
  it('validates generated source and locked catalogs against production floors', () => {
    expect(() => assertIamCatalog(generatedSourceCatalog, LOCKED_CATALOG_MINIMUMS)).not.toThrow();
    expect(() => assertIamCatalog(lockedCatalog, LOCKED_CATALOG_MINIMUMS)).not.toThrow();
  });

  it.each([
    's3:Get*Tagging',
    'iam:GetRolePolicy',
    'ec2:DescribeInstances',
  ])('preserves representative expansion for %s', (pattern) => {
    expect(expandIamAction(pattern, lockedCatalog.actions)).toEqual(
      expandIamAction(pattern, generatedSourceCatalog.actions),
    );
  });

  it.each([
    's3:GetObject',
    'elasticfilesystem:DescribeFileSystems',
    'sso:CreateApplication',
  ])('preserves representative documentation links for %s', (action) => {
    expect(getActionDocUrl(action, lockedCatalog.serviceDocSlugs)).toBe(
      getActionDocUrl(action, generatedSourceCatalog.serviceDocSlugs),
    );
  });
});
