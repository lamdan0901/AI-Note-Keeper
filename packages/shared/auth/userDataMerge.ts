export type MergeStrategy = 'cloud' | 'local' | 'both';

export type MergeCounts = {
  notes: number;
  subscriptions: number;
  tokens: number;
  events: number;
};

export type MergeSummary = {
  sourceEmpty: boolean;
  sourceSampleOnly: boolean;
  targetEmpty: boolean;
  hasConflicts: boolean;
  sourceCounts: MergeCounts;
  targetCounts: MergeCounts;
};

export type MergeResolution = 'cloud' | 'local' | 'prompt';

export const resolveMergeResolution = (summary: MergeSummary): MergeResolution => {
  if (summary.sourceEmpty || summary.sourceSampleOnly) {
    return 'cloud';
  }

  if (summary.targetEmpty) {
    return 'local';
  }

  return 'prompt';
};
