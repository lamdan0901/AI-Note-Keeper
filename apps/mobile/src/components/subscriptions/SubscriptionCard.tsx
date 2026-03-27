import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Subscription } from '../../../../../packages/shared/types/subscription';
import { type Theme, useTheme } from '../../theme';
import {
  formatBillingCycle,
  formatPrice,
  getDaysUntilBilling,
} from '../../../../../packages/shared/utils/subscription';
import { createHoldInteraction, getTapDecision, HOLD_DELAY_MS } from '../noteCardInteractions';

type ViewMode = 'grid' | 'list';

interface SubscriptionCardProps {
  subscription: Subscription;
  variant: ViewMode;
  isSelected: boolean;
  selectionMode: boolean;
  resolvedMode: 'light' | 'dark';
  onOpen: (subscription: Subscription) => void;
  onToggleSelection: (subscriptionId: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  streaming: 'Streaming',
  music: 'Music',
  tools: 'Tools',
  productivity: 'Productivity',
  gaming: 'Gaming',
  news: 'News',
  fitness: 'Fitness',
  cloud: 'Cloud',
  other: 'Other',
};

const formatSubCategory = (category: string): string => {
  const trimmed = category.trim();
  if (!trimmed) return 'Other';

  const normalized = trimmed.toLowerCase();
  const fromKnown = CATEGORY_LABELS[normalized];
  if (fromKnown) return fromKnown;

  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const areRenderedSubscriptionFieldsEqual = (left: Subscription, right: Subscription): boolean => {
  return (
    left.id === right.id &&
    left.serviceName === right.serviceName &&
    left.status === right.status &&
    left.category === right.category &&
    left.price === right.price &&
    left.currency === right.currency &&
    left.billingCycle === right.billingCycle &&
    left.billingCycleCustomDays === right.billingCycleCustomDays &&
    left.nextBillingDate === right.nextBillingDate
  );
};

export const areSubscriptionCardPropsEqual = (
  prevProps: Readonly<SubscriptionCardProps>,
  nextProps: Readonly<SubscriptionCardProps>,
): boolean => {
  return (
    prevProps.variant === nextProps.variant &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.selectionMode === nextProps.selectionMode &&
    prevProps.resolvedMode === nextProps.resolvedMode &&
    areRenderedSubscriptionFieldsEqual(prevProps.subscription, nextProps.subscription)
  );
};

function SubscriptionCardComponent({
  subscription,
  variant,
  isSelected,
  selectionMode,
  resolvedMode,
  onOpen,
  onToggleSelection,
}: SubscriptionCardProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const holdHandlerRef = useRef<(() => void) | null>(null);
  const holdInteractionRef = useRef<ReturnType<typeof createHoldInteraction> | null>(null);

  holdHandlerRef.current = () => {
    onToggleSelection(subscription.id);
  };

  if (!holdInteractionRef.current) {
    holdInteractionRef.current = createHoldInteraction({
      delayMs: HOLD_DELAY_MS,
      onHold: () => holdHandlerRef.current?.(),
    });
  }

  useEffect(() => {
    return () => {
      holdInteractionRef.current?.end();
    };
  }, []);

  const isDarkMode = resolvedMode === 'dark';
  const daysUntil = useMemo(
    () => getDaysUntilBilling(subscription.nextBillingDate),
    [subscription.nextBillingDate],
  );
  const nextBillingLabel =
    daysUntil < 0 ? 'Overdue' : daysUntil === 0 ? 'Today' : `${daysUntil}d left`;
  const countdownTone =
    daysUntil < 0 ? 'overdue' : daysUntil <= 3 ? 'urgent' : daysUntil <= 7 ? 'warning' : 'ok';

  const handlePress = () => {
    if (holdInteractionRef.current?.consumeHoldFired()) return;

    const decision = getTapDecision({ selectionModeActive: selectionMode });
    if (decision === 'toggleSelection') {
      onToggleSelection(subscription.id);
      return;
    }

    onOpen(subscription);
  };

  return (
    <Pressable
      style={[
        styles.card,
        variant === 'grid' && styles.cardGrid,
        isSelected && styles.cardSelected,
      ]}
      onPressIn={() => holdInteractionRef.current?.start()}
      onPressOut={() => holdInteractionRef.current?.end()}
      onPress={handlePress}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>{subscription.serviceName}</Text>
        <View
          style={[
            styles.statusDot,
            subscription.status === 'active'
              ? styles.statusActive
              : subscription.status === 'paused'
                ? styles.statusPaused
                : styles.statusCancelled,
          ]}
        />
      </View>
      <Text style={[styles.cardCategory, styles.cardCountdownChip]} numberOfLines={1}>
        {formatSubCategory(subscription.category)}
      </Text>
      <Text style={styles.cardPricingLine}>
        <Text style={styles.cardPrice}>
          {formatPrice(subscription.price, subscription.currency)}
        </Text>
        <Text style={styles.cardCycle}>
          {' '}
          / {formatBillingCycle(subscription.billingCycle, subscription.billingCycleCustomDays)}
        </Text>
      </Text>
      {subscription.status === 'active' && (
        <View
          style={[
            styles.cardCountdownChip,
            countdownTone === 'ok' &&
              (isDarkMode ? styles.cardCountdownOkDark : styles.cardCountdownOk),
            countdownTone === 'warning' &&
              (isDarkMode ? styles.cardCountdownWarningDark : styles.cardCountdownWarning),
            (countdownTone === 'urgent' || countdownTone === 'overdue') &&
              (isDarkMode ? styles.cardCountdownUrgentDark : styles.cardCountdownUrgent),
          ]}
        >
          <Text
            style={[
              styles.cardCountdownText,
              countdownTone === 'ok' &&
                (isDarkMode ? styles.cardCountdownTextOkDark : styles.cardCountdownTextOk),
              countdownTone === 'warning' &&
                (isDarkMode
                  ? styles.cardCountdownTextWarningDark
                  : styles.cardCountdownTextWarning),
              (countdownTone === 'urgent' || countdownTone === 'overdue') &&
                (isDarkMode ? styles.cardCountdownTextUrgentDark : styles.cardCountdownTextUrgent),
            ]}
          >
            Next billing: {nextBillingLabel}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export const SubscriptionCard = React.memo(
  SubscriptionCardComponent,
  areSubscriptionCardPropsEqual,
);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.md,
      gap: 6,
    },
    cardSelected: {
      borderColor: theme.colors.primary,
      borderWidth: 2,
    },
    cardGrid: {
      // Intentionally empty: grid cards should use intrinsic height.
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    cardTitle: {
      flex: 1,
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: theme.typography.sizes.base,
    },
    cardPricingLine: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.base,
    },
    cardCategory: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.xs,
      backgroundColor: theme.colors.secondary,
    },
    cardPrice: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.base,
      fontWeight: '700',
    },
    cardCycle: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      fontWeight: '500',
    },
    cardCountdownChip: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 3,
      alignSelf: 'flex-start',
    },
    cardCountdownText: {
      fontSize: 12,
      fontWeight: '600',
    },
    cardCountdownOk: {
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
    },
    cardCountdownWarning: {
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
    },
    cardCountdownUrgent: {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
    },
    cardCountdownOkDark: {
      backgroundColor: 'rgba(34, 197, 94, 0.2)',
    },
    cardCountdownWarningDark: {
      backgroundColor: 'rgba(245, 158, 11, 0.22)',
    },
    cardCountdownUrgentDark: {
      backgroundColor: 'rgba(239, 68, 68, 0.22)',
    },
    cardCountdownTextOk: {
      color: '#166534',
    },
    cardCountdownTextWarning: {
      color: '#92400e',
    },
    cardCountdownTextUrgent: {
      color: '#991b1b',
    },
    cardCountdownTextOkDark: {
      color: '#86efac',
    },
    cardCountdownTextWarningDark: {
      color: '#fcd34d',
    },
    cardCountdownTextUrgentDark: {
      color: '#fca5a5',
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusActive: {
      backgroundColor: theme.colors.success,
    },
    statusPaused: {
      backgroundColor: theme.colors.cta,
    },
    statusCancelled: {
      backgroundColor: theme.colors.error,
    },
  });
