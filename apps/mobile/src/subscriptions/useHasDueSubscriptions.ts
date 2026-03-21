import { useMemo } from 'react';
import { isReminderDue } from '../../../../packages/shared/utils/subscription';
import { useSubscriptions } from './service';

export function useHasDueSubscriptions(): boolean {
  const subscriptions = useSubscriptions();

  return useMemo(() => {
    if (!subscriptions) return false;
    return subscriptions.some(isReminderDue);
  }, [subscriptions]);
}
