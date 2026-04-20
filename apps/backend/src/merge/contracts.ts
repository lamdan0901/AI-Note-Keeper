import { z } from 'zod';

export const mergeStrategySchema = z.enum(['cloud', 'local', 'both']);

export type MergeStrategy = z.infer<typeof mergeStrategySchema>;

export type MergeCounts = Readonly<{
  notes: number;
  subscriptions: number;
  tokens: number;
  events: number;
}>;

export type MergeSummary = Readonly<{
  sourceEmpty: boolean;
  sourceSampleOnly: boolean;
  targetEmpty: boolean;
  hasConflicts: boolean;
  sourceCounts: MergeCounts;
  targetCounts: MergeCounts;
}>;

export type MergeResolution = 'cloud' | 'local' | 'prompt';

export type MergePreflightInput = Readonly<{
  fromUserId: string;
  toUserId: string;
  username: string;
  password: string;
}>;

export type MergeApplyInput = MergePreflightInput &
  Readonly<{
    strategy: MergeStrategy;
  }>;

export type MergePreflightResult = Readonly<{
  summary: MergeSummary;
}>;

export type MergeApplyResult = Readonly<{
  strategy: MergeStrategy;
  resolution: MergeResolution;
  summary: MergeSummary;
}>;

export const mergePreflightBodySchema = z.object({
  toUserId: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const mergeApplyBodySchema = mergePreflightBodySchema.extend({
  strategy: mergeStrategySchema,
});

export type MergePreflightBody = z.infer<typeof mergePreflightBodySchema>;
export type MergeApplyBody = z.infer<typeof mergeApplyBodySchema>;
