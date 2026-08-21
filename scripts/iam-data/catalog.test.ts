import { describe, expect, it } from 'vitest';

import {
  assertIamCatalog,
  type IamCatalog,
  LOCKED_CATALOG_MINIMUMS,
} from './catalog.js';

function catalog(overrides: Partial<IamCatalog> = {}): IamCatalog {
  return {
    actions: ['s3:GetObject', 's3:PutObject'],
    serviceDocSlugs: { s3: 'amazons3' },
    ...overrides,
  };
}

describe('assertIamCatalog', () => {
  it('accepts a sorted catalog with complete service documentation', () => {
    expect(() => assertIamCatalog(catalog())).not.toThrow();
    expect(() => assertIamCatalog(catalog({
      actions: ['vpc-lattice:AssociateViaAWSService-EventsAndStates'],
      serviceDocSlugs: { 'vpc-lattice': 'amazonvpclattice' },
    }))).not.toThrow();
  });

  it('enforces minimum action and service counts', () => {
    expect(() => assertIamCatalog(catalog(), { actionCount: 3, serviceCount: 1 })).toThrow(
      'IAM catalog has 2 actions; expected at least 3',
    );
    expect(() => assertIamCatalog(catalog(), { actionCount: 2, serviceCount: 2 })).toThrow(
      'IAM catalog has 1 services; expected at least 2',
    );
  });

  it('rejects malformed, duplicate, and unsorted actions', () => {
    expect(() => assertIamCatalog(catalog({ actions: ['not-an-action'] }))).toThrow(
      'Invalid IAM action: not-an-action',
    );
    expect(() => assertIamCatalog(catalog({
      actions: ['s3:GetObject', 's3:GetObject'],
    }))).toThrow('Duplicate IAM action: s3:GetObject');
    expect(() => assertIamCatalog(catalog({
      actions: ['s3:PutObject', 's3:GetObject'],
    }))).toThrow('IAM actions are not sorted: s3:PutObject before s3:GetObject');
  });

  it('rejects unsorted service prefixes and invalid slugs', () => {
    expect(() => assertIamCatalog(catalog({
      actions: ['ec2:DescribeInstances', 's3:GetObject'],
      serviceDocSlugs: { s3: 'amazons3', ec2: 'amazonec2' },
    }))).toThrow('IAM service prefixes are not sorted: s3');
    expect(() => assertIamCatalog(catalog({
      serviceDocSlugs: { s3: 'Amazon S3' },
    }))).toThrow('Invalid IAM service documentation slug for s3: Amazon S3');
    expect(() => assertIamCatalog(catalog({
      serviceDocSlugs: { s3: undefined as unknown as string },
    }))).toThrow('Invalid IAM service documentation slug for s3: <missing>');
  });

  it('rejects missing and extra service documentation mappings', () => {
    expect(() => assertIamCatalog(catalog({
      serviceDocSlugs: { ec2: 'amazonec2', s3: 'amazons3' },
    }))).toThrow('IAM service documentation has no actions: ec2');
    expect(() => assertIamCatalog(catalog({
      actions: ['ec2:DescribeInstances', 's3:GetObject'],
      serviceDocSlugs: { s3: 'amazons3' },
    }))).toThrow('Missing IAM service documentation slug: ec2');
  });

  it('defines conservative locked-catalog floors', () => {
    expect(LOCKED_CATALOG_MINIMUMS).toEqual({
      actionCount: 20_000,
      serviceCount: 400,
    });
  });
});
