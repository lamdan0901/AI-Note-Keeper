import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateFinalizeGuard } from '../decommission/finalizeGuard.js';

const checklistFixture = `
pre-decommission tag: v1.0.0-pre-decommission
reconcile report: docs/reconcile/final.json
release owner sign-off: 2026-04-19T10:00:00.000Z
sign-off completed by release owner
`;

test('blocks when reconcile artifact is missing or older than stage-a verification timestamp', () => {
  const missingReconcile = evaluateFinalizeGuard({
    stageAVerified: true,
    stageAVerifiedAt: '2026-04-19T10:00:00.000Z',
    preDecommissionTag: 'v1.0.0-pre-decommission',
    checklistContent: checklistFixture,
    releaseOwnerSignOffAt: '2026-04-19T10:10:00.000Z',
  });

  assert.equal(missingReconcile.pass, false);
  assert.deepEqual(missingReconcile.reasons, ['reconcile_artifact_missing']);

  const staleReconcile = evaluateFinalizeGuard({
    stageAVerified: true,
    stageAVerifiedAt: '2026-04-19T10:00:00.000Z',
    reconcileArtifactAt: '2026-04-19T09:59:59.000Z',
    preDecommissionTag: 'v1.0.0-pre-decommission',
    checklistContent: checklistFixture,
    releaseOwnerSignOffAt: '2026-04-19T10:10:00.000Z',
  });

  assert.equal(staleReconcile.pass, false);
  assert.deepEqual(staleReconcile.reasons, ['reconcile_artifact_outdated']);
});

test('blocks when pre-decommission tag, checklist artifact, or release-owner sign-off is missing', () => {
  const result = evaluateFinalizeGuard({
    stageAVerified: true,
    reconcileArtifactAt: '2026-04-19T10:02:00.000Z',
    stageAVerifiedAt: '2026-04-19T10:00:00.000Z',
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.reasons, [
    'pre_decommission_tag_missing',
    'release_owner_sign_off_missing',
    'checklist_artifact_missing',
  ]);
});

test('blocks when stage-a verification marker is absent', () => {
  const result = evaluateFinalizeGuard({
    stageAVerified: false,
    stageAVerifiedAt: '2026-04-19T10:00:00.000Z',
    reconcileArtifactAt: '2026-04-19T10:02:00.000Z',
    preDecommissionTag: 'v1.0.0-pre-decommission',
    checklistContent: checklistFixture,
    releaseOwnerSignOffAt: '2026-04-19T10:10:00.000Z',
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.reasons, ['stage_a_verification_missing']);
});

test('passes when all stage-b prerequisites are complete and ordered', () => {
  const result = evaluateFinalizeGuard({
    stageAVerified: true,
    stageAVerifiedAt: '2026-04-19T10:00:00.000Z',
    reconcileArtifactAt: '2026-04-19T10:02:00.000Z',
    preDecommissionTag: 'v1.0.0-pre-decommission',
    checklistContent: checklistFixture,
    releaseOwnerSignOffAt: '2026-04-19T10:10:00.000Z',
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});