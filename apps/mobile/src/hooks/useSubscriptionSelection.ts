import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { Subscription } from '../../../../packages/shared/types/subscription';

type UseSubscriptionSelectionResult = {
  selectedSubscriptionIds: Set<string>;
  selectionMode: boolean;
  selectionHeaderAnim: Animated.Value;
  clearSelection: () => void;
  removeSelectedSubscriptionIds: (subscriptionIds: string[]) => void;
  handleSubscriptionLongPress: (subscriptionId: string) => void;
};

export const useSubscriptionSelection = (
  subscriptions: Subscription[],
): UseSubscriptionSelectionResult => {
  const [selectedSubscriptionIds, setSelectedSubscriptionIds] = useState<Set<string>>(new Set());
  const selectionHeaderAnim = useRef(new Animated.Value(0)).current;
  const selectionMode = selectedSubscriptionIds.size > 0;

  useEffect(() => {
    Animated.timing(selectionHeaderAnim, {
      toValue: selectionMode ? 1 : 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [selectionHeaderAnim, selectionMode]);

  useEffect(() => {
    if (selectedSubscriptionIds.size === 0) return;

    const currentIds = new Set(subscriptions.map((subscription) => subscription.id));
    setSelectedSubscriptionIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (currentIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [subscriptions, selectedSubscriptionIds.size]);

  const clearSelection = useCallback(() => {
    setSelectedSubscriptionIds(new Set());
  }, []);

  const removeSelectedSubscriptionIds = useCallback((subscriptionIds: string[]) => {
    if (subscriptionIds.length === 0) return;

    setSelectedSubscriptionIds((prev) => {
      const next = new Set(prev);
      subscriptionIds.forEach((id) => {
        next.delete(id);
      });
      return next;
    });
  }, []);

  const handleSubscriptionLongPress = useCallback((subscriptionId: string) => {
    setSelectedSubscriptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(subscriptionId)) next.delete(subscriptionId);
      else next.add(subscriptionId);
      return next;
    });
  }, []);

  return {
    selectedSubscriptionIds,
    selectionMode,
    selectionHeaderAnim,
    clearSelection,
    removeSelectedSubscriptionIds,
    handleSubscriptionLongPress,
  };
};
