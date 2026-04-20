import { readFile, stat } from 'node:fs/promises';

export type FinalizeGuardReason =
  | 'stage_a_verification_missing'
  | 'reconcile_artifact_missing'
  | 'reconcile_artifact_outdated'
  | 'pre_decommission_tag_missing'
  | 'checklist_artifact_missing'
  | 'checklist_pre_decommission_tag_missing'
  | 'checklist_reconcile_missing'
  | 'checklist_sign_off_missing'
  | 'checklist_release_owner_missing'
  | 'release_owner_sign_off_missing';

export type FinalizeGuardInput = Readonly<{
  stageAVerified: boolean;
  stageAVerifiedAt?: string;
  reconcileArtifactAt?: string;
  preDecommissionTag?: string;
  checklistContent?: string;
  releaseOwnerSignOffAt?: string;
}>;

export type FinalizeGuardResult = Readonly<{
  pass: boolean;
  reasons: ReadonlyArray<FinalizeGuardReason>;
}>;

const pushIf = (
  reasons: FinalizeGuardReason[],
  shouldPush: boolean,
  reason: FinalizeGuardReason,
): void => {
  if (shouldPush) {
    reasons.push(reason);
  }
};

const parseIso = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const containsToken = (content: string, token: string): boolean => {
  return content.toLowerCase().includes(token.toLowerCase());
};

export const evaluateFinalizeGuard = (input: FinalizeGuardInput): FinalizeGuardResult => {
  const reasons: FinalizeGuardReason[] = [];

  pushIf(reasons, !input.stageAVerified, 'stage_a_verification_missing');
  pushIf(reasons, !input.reconcileArtifactAt, 'reconcile_artifact_missing');
  pushIf(reasons, !input.preDecommissionTag, 'pre_decommission_tag_missing');
  pushIf(reasons, !input.releaseOwnerSignOffAt, 'release_owner_sign_off_missing');

  const stageATimestamp = parseIso(input.stageAVerifiedAt);
  const reconcileTimestamp = parseIso(input.reconcileArtifactAt);
  if (
    stageATimestamp !== null &&
    reconcileTimestamp !== null &&
    reconcileTimestamp < stageATimestamp
  ) {
    reasons.push('reconcile_artifact_outdated');
  }

  if (!input.checklistContent) {
    reasons.push('checklist_artifact_missing');
  } else {
    const checklist = input.checklistContent;

    pushIf(
      reasons,
      !containsToken(checklist, 'pre-decommission tag'),
      'checklist_pre_decommission_tag_missing',
    );
    pushIf(reasons, !containsToken(checklist, 'reconcile'), 'checklist_reconcile_missing');
    pushIf(reasons, !containsToken(checklist, 'sign-off'), 'checklist_sign_off_missing');
    pushIf(reasons, !containsToken(checklist, 'release owner'), 'checklist_release_owner_missing');
  }

  return {
    pass: reasons.length === 0,
    reasons,
  };
};

const readFileSafely = async (path: string | undefined): Promise<string | undefined> => {
  if (!path) {
    return undefined;
  }

  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
};

const readMtimeIsoSafely = async (path: string | undefined): Promise<string | undefined> => {
  if (!path) {
    return undefined;
  }

  try {
    const metadata = await stat(path);
    return metadata.mtime.toISOString();
  } catch {
    return undefined;
  }
};

const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
};

const runCli = async (): Promise<void> => {
  const checklistPath = readArg('--checklist');
  const reconcilePath = readArg('--reconcile');

  const checklistContent = await readFileSafely(checklistPath);
  const reconcileArtifactAt =
    readArg('--reconcile-at') ?? (await readMtimeIsoSafely(reconcilePath));

  const result = evaluateFinalizeGuard({
    stageAVerified: readArg('--stage-a-verified') === 'true',
    stageAVerifiedAt: readArg('--stage-a-verified-at'),
    reconcileArtifactAt,
    preDecommissionTag: readArg('--pre-decommission-tag'),
    checklistContent,
    releaseOwnerSignOffAt: readArg('--release-owner-sign-off-at'),
  });

  if (!result.pass) {
    console.error('Finalize guard blocked:');
    for (const reason of result.reasons) {
      console.error(`- ${reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Finalize guard passed.');
};

if (process.argv[1] && process.argv[1].endsWith('finalizeGuard.ts')) {
  void runCli();
}
