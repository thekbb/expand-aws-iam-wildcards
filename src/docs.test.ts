import { describe, it, expect } from 'vitest';
import { getActionDocUrl, formatActionWithLink } from './docs.js';

describe('getActionDocUrl', () => {
  it('returns URL for known S3 action', () => {
    const url = getActionDocUrl('s3:GetObject');
    expect(url).toBe(
      'https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#amazons3-actions-as-permissions:~:text=GetObject'
    );
  });

  it('returns URL for known DynamoDB action', () => {
    const url = getActionDocUrl('dynamodb:GetItem');
    expect(url).toContain('list_amazondynamodb.html');
    expect(url).toContain(':~:text=GetItem');
  });

  it('returns URL for known EC2 action', () => {
    const url = getActionDocUrl('ec2:DescribeInstances');
    expect(url).toContain('list_amazonec2.html');
    expect(url).toContain(':~:text=DescribeInstances');
  });

  it('returns URL for known IAM action', () => {
    const url = getActionDocUrl('iam:CreateRole');
    expect(url).toContain('list_awsidentityandaccessmanagementiam.html');
    expect(url).toContain(':~:text=CreateRole');
  });

  it('returns null for unknown service', () => {
    const url = getActionDocUrl('unknownservice:SomeAction');
    expect(url).toBeNull();
  });

  it('returns null for invalid action format', () => {
    expect(getActionDocUrl('invalid')).toBeNull();
    expect(getActionDocUrl('')).toBeNull();
  });

  it('handles case-insensitive service prefix', () => {
    const url = getActionDocUrl('S3:GetObject');
    expect(url).toContain('list_amazons3.html');
  });
});

describe('formatActionWithLink', () => {
  it('formats known service action as markdown link', () => {
    const result = formatActionWithLink('s3:GetObject');
    expect(result).toBe(
      '[s3:GetObject](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#amazons3-actions-as-permissions:~:text=GetObject)'
    );
  });

  it('formats unknown service action as quoted string', () => {
    const result = formatActionWithLink('unknownservice:Action');
    expect(result).toBe('"unknownservice:Action"');
  });
});
