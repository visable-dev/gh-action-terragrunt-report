import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  NO_CHANGES_SUMMARY,
  analyzeDiff,
  emptyResultsConclusion,
  resolvePrettyName,
  sanitizeArtifactName,
  shouldUploadArtifact,
} from '../src/lib/report.ts';

describe('resolvePrettyName', () => {
  it('returns the filename when no regex is configured', () => {
    const result = resolvePrettyName('/example/prod.diff', null, '/');
    assert.equal(result.name, '/example/prod.diff');
    assert.equal(result.warning, undefined);
  });

  it('joins capture groups for nested paths', () => {
    const regex = /\/example_project\/([\w/]+)\/(\w+)\.diff/;
    const result = resolvePrettyName(
      '/example_project/qa/box1/box1.diff',
      regex,
      '/',
    );
    assert.equal(result.name, 'qa/box1/box1');
    assert.equal(result.warning, undefined);
  });

  it('returns a warning when the regex does not match', () => {
    const regex = /\/example_project\/([\w/]+)\/(\w+)\.diff/;
    const result = resolvePrettyName('/other/path.diff', regex, '/');
    assert.equal(result.name, '/other/path.diff');
    assert.match(result.warning ?? '', /No match found/);
  });
});

describe('analyzeDiff', () => {
  it('detects plans without infrastructure changes', () => {
    const diff = `Terraform will perform the following actions:

${NO_CHANGES_SUMMARY}`;

    const result = analyzeDiff(diff, '/example/prod.diff');
    assert.equal(result.conclusion, 'success');
    assert.equal(result.output.title, NO_CHANGES_SUMMARY);
  });

  it('detects output-only changes', () => {
    const diff =
      'You can apply this plan to save these new output values to the Terraform state, without changing any real infrastructure.';

    const result = analyzeDiff(diff, '/example/prod.diff');
    assert.equal(result.conclusion, 'success');
    assert.equal(result.output.title, NO_CHANGES_SUMMARY);
  });

  it('parses plan summaries and marks changes as neutral', () => {
    const diff = `Plan: 2 to add, 1 to change, 0 to destroy.

Terraform will perform the following actions:`;

    const result = analyzeDiff(diff, '/example/prod/prod.diff');
    assert.equal(result.conclusion, 'neutral');
    assert.equal(
      result.output.title,
      'Plan: 2 to add, 1 to change, 0 to destroy.',
    );
    assert.match(result.output.text ?? '', /```terraform/);
  });

  it('throws for invalid diff files', () => {
    assert.throws(
      () => analyzeDiff('not a terraform plan', '/broken.diff'),
      /wrong format/,
    );
  });
});

describe('sanitizeArtifactName', () => {
  it('replaces characters that are invalid for artifact names', () => {
    assert.equal(
      sanitizeArtifactName('prod/stage:large'),
      'prod-stage-large',
    );
  });
});

describe('emptyResultsConclusion', () => {
  it('defaults to failure unless success is requested', () => {
    assert.equal(emptyResultsConclusion('failure'), 'failure');
    assert.equal(emptyResultsConclusion(''), 'failure');
    assert.equal(emptyResultsConclusion('success'), 'success');
  });
});

describe('shouldUploadArtifact', () => {
  it('requires oversized output text', () => {
    assert.equal(shouldUploadArtifact(undefined), false);
    assert.equal(shouldUploadArtifact('x'.repeat(65535)), false);
    assert.equal(shouldUploadArtifact('x'.repeat(65536)), true);
  });
});
