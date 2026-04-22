import { MergeStrategy } from '../../../../packages/shared/auth/userDataMerge';

export type AuthSuccessFlow = 'login' | 'register' | 'merge';

export type LocalDataAction = 'preserve' | 'clear' | 'migrate';

export const resolveLocalDataAction = (input: {
  flowLabel: AuthSuccessFlow;
  strategy?: MergeStrategy | 'cloud';
}): LocalDataAction => {
  if (input.flowLabel === 'login') {
    return 'preserve';
  }

  if (input.flowLabel === 'register') {
    return 'migrate';
  }

  if (input.strategy == null) {
    throw new Error('Merge strategy is required for merge flow');
  }

  if (input.strategy === 'cloud') {
    return 'clear';
  }

  return 'migrate';
};
