import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
} from '../../../../packages/shared/types/subscription';
import { type Theme, useTheme } from '../theme';
import { SettingsDrawer } from '../components/SettingsDrawer';
import { SubscriptionEditorModal } from '../components/subscriptions/SubscriptionEditorModal';
import {
  createSubscription,
  updateSubscription,
  useCreateSubscription,
  useSubscriptions,
  useUpdateSubscription,
} from '../subscriptions/service';
import {
  computeTotalMonthlyCost,
  formatBillingCycle,
  formatPrice,
  getDaysUntilBilling,
} from '../../../../packages/shared/utils/subscription';

type SubscriptionsScreenProps = {
  onNavigateToNotes: () => void;
  onNavigateToTrash?: () => void;
};

type ViewMode = 'grid' | 'list';

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

const SubscriptionsScreenContent: React.FC<SubscriptionsScreenProps> = ({
  onNavigateToNotes,
  onNavigateToTrash,
}) => {
  const { theme, resolvedMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const subscriptions = useSubscriptions();
  const createMutate = useCreateSubscription();
  const updateMutate = useUpdateSubscription();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  const hasSearchValue = searchQuery.trim().length > 0;
  const isSearchExpanded = hasSearchValue || searchFocused;

  const openDrawer = useCallback(() => {
    setDrawerVisible(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setDrawerVisible(false);
    });
  }, [drawerAnim]);

  const handleOpenSearch = useCallback(() => {
    setSearchFocused(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const handleCollapseSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFocused(false);
    Keyboard.dismiss();
  }, []);

  const handleOpenNew = useCallback(() => {
    setEditingSubscription(null);
    setEditorVisible(true);
  }, []);

  const handleOpenEdit = useCallback((subscription: Subscription) => {
    setEditingSubscription(subscription);
    setEditorVisible(true);
  }, []);

  const handleCloseEditor = useCallback(() => {
    if (savingSubscription) return;
    setEditorVisible(false);
    setEditingSubscription(null);
  }, [savingSubscription]);

  const handleSaveSubscription = useCallback(
    async (data: SubscriptionCreate | SubscriptionUpdate) => {
      setSavingSubscription(true);
      try {
        if (editingSubscription) {
          await updateSubscription(
            updateMutate,
            editingSubscription.id,
            data as SubscriptionUpdate,
          );
        } else {
          await createSubscription(createMutate, data as SubscriptionCreate);
        }
        setEditorVisible(false);
        setEditingSubscription(null);
      } catch {
        Alert.alert('Save failed', 'Unable to save subscription. Please try again.');
      } finally {
        setSavingSubscription(false);
      }
    },
    [createMutate, editingSubscription, updateMutate],
  );

  const list = useMemo(() => subscriptions ?? [], [subscriptions]);
  const existingCategories = useMemo(
    () =>
      Array.from(
        new Set(
          list
            .map((item) => item.category.trim())
            .filter((value): value is string => value.length > 0),
        ),
      ),
    [list],
  );
  const filtered = searchQuery.trim()
    ? list.filter((item) => item.serviceName.toLowerCase().includes(searchQuery.toLowerCase()))
    : list;

  const totalMonthly = computeTotalMonthlyCost(list);
  const primaryCurrency = list[0]?.currency ?? 'USD';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.iconButton} onPress={openDrawer} accessibilityLabel="Open menu">
            <Ionicons name="menu" size={26} color={theme.colors.text} />
          </Pressable>
          {!isSearchExpanded && <Text style={styles.headerTitle}>Subscriptions</Text>}
        </View>

        <View style={styles.headerRight}>
          {isSearchExpanded ? (
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={16} color={theme.colors.textMuted} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search subscriptions"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search subscriptions"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                returnKeyType="search"
              />
              {hasSearchValue ? (
                <Pressable
                  style={styles.searchActionButton}
                  onPress={handleClearSearch}
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close" size={16} color={theme.colors.textMuted} />
                </Pressable>
              ) : (
                <Pressable
                  style={styles.searchActionButton}
                  onPress={handleCollapseSearch}
                  accessibilityLabel="Close search"
                >
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
                </Pressable>
              )}
            </View>
          ) : (
            <Pressable
              style={styles.iconButton}
              onPress={handleOpenSearch}
              accessibilityLabel="Open search"
            >
              <Ionicons name="search" size={22} color={theme.colors.text} />
            </Pressable>
          )}
          <Pressable
            style={styles.iconButton}
            onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            accessibilityLabel="Toggle view mode"
          >
            <Ionicons
              name={viewMode === 'grid' ? 'list' : 'grid'}
              size={24}
              color={theme.colors.primary}
            />
          </Pressable>
        </View>
      </View>

      <SettingsDrawer
        visible={drawerVisible}
        onClose={closeDrawer}
        drawerAnim={drawerAnim}
        activeScreen="subscriptions"
        onNotesPress={() => {
          closeDrawer();
          onNavigateToNotes();
        }}
        onSubscriptionsPress={closeDrawer}
        onTrashPress={() => {
          closeDrawer();
          onNavigateToTrash?.();
        }}
        showDueSubscriptionsIndicator={false}
      />

      {list.length > 0 && (
        <View style={styles.totalRow}>
          <Text style={styles.totalText}>
            Total: {formatPrice(totalMonthly, primaryCurrency)}/mo
          </Text>
        </View>
      )}

      {subscriptions === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="card-outline" size={54} color={theme.colors.textMuted} />
          <Text style={styles.emptyText}>
            {searchQuery.trim()
              ? 'No subscriptions match your search.'
              : 'No subscriptions yet. Add one to get started.'}
          </Text>
        </View>
      ) : (
        <FlatList
          key={viewMode}
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={viewMode === 'grid' ? 2 : 1}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={viewMode === 'grid' ? styles.gridColumns : undefined}
          renderItem={({ item }) => {
            const daysUntil = getDaysUntilBilling(item.nextBillingDate);
            const nextBillingLabel =
              daysUntil < 0 ? 'Overdue' : daysUntil === 0 ? 'Today' : `${daysUntil}d left`;
            const countdownTone =
              daysUntil < 0
                ? 'overdue'
                : daysUntil <= 3
                  ? 'urgent'
                  : daysUntil <= 7
                    ? 'warning'
                    : 'ok';
            const isDarkMode = resolvedMode === 'dark';

            return (
              <Pressable
                style={[styles.card, viewMode === 'grid' && styles.cardGrid]}
                onPress={() => handleOpenEdit(item)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.serviceName}
                  </Text>
                  <View
                    style={[
                      styles.statusDot,
                      item.status === 'active'
                        ? styles.statusActive
                        : item.status === 'paused'
                          ? styles.statusPaused
                          : styles.statusCancelled,
                    ]}
                  />
                </View>
                <Text style={[styles.cardCategory, styles.cardCountdownChip]} numberOfLines={1}>
                  {formatSubCategory(item.category)}
                </Text>
                <Text style={styles.cardPricingLine}>
                  <Text style={styles.cardPrice}>{formatPrice(item.price, item.currency)}</Text>
                  <Text style={styles.cardCycle}>
                    {' '}
                    / {formatBillingCycle(item.billingCycle, item.billingCycleCustomDays)}
                  </Text>
                </Text>
                {item.status === 'active' && (
                  <View
                    style={[
                      styles.cardCountdownChip,
                      countdownTone === 'ok' &&
                        (isDarkMode ? styles.cardCountdownOkDark : styles.cardCountdownOk),
                      countdownTone === 'warning' &&
                        (isDarkMode
                          ? styles.cardCountdownWarningDark
                          : styles.cardCountdownWarning),
                      (countdownTone === 'urgent' || countdownTone === 'overdue') &&
                        (isDarkMode ? styles.cardCountdownUrgentDark : styles.cardCountdownUrgent),
                    ]}
                  >
                    <Text
                      style={[
                        styles.cardCountdownText,
                        countdownTone === 'ok' &&
                          (isDarkMode
                            ? styles.cardCountdownTextOkDark
                            : styles.cardCountdownTextOk),
                        countdownTone === 'warning' &&
                          (isDarkMode
                            ? styles.cardCountdownTextWarningDark
                            : styles.cardCountdownTextWarning),
                        (countdownTone === 'urgent' || countdownTone === 'overdue') &&
                          (isDarkMode
                            ? styles.cardCountdownTextUrgentDark
                            : styles.cardCountdownTextUrgent),
                      ]}
                    >
                      Next billing: {nextBillingLabel}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        style={styles.fab}
        onPress={handleOpenNew}
        accessibilityLabel="Create subscription"
      >
        <Ionicons name="add" size={32} color="white" />
      </Pressable>

      <SubscriptionEditorModal
        visible={editorVisible}
        subscription={editingSubscription}
        existingCategories={existingCategories}
        saving={savingSubscription}
        onClose={handleCloseEditor}
        onSave={handleSaveSubscription}
      />

      <Pressable
        style={styles.backButton}
        onPress={onNavigateToNotes}
        accessibilityLabel="Back to notes"
      >
        <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
        <Text style={styles.backButtonLabel}>Notes</Text>
      </Pressable>
    </SafeAreaView>
  );
};

export const SubscriptionsScreen: React.FC<SubscriptionsScreenProps> = (props) => {
  return <SubscriptionsScreenContent {...props} />;
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      padding: theme.spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.sm,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flex: 1,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 1,
    },
    headerTitle: {
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
      fontFamily: theme.typography.fontFamily,
    },
    iconButton: {
      padding: theme.spacing.xs,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 18,
      paddingLeft: 10,
      paddingRight: 4,
      height: 36,
      minWidth: 170,
      maxWidth: 240,
      backgroundColor: theme.colors.background,
    },
    searchInput: {
      flex: 1,
      minWidth: 90,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontFamily: theme.typography.fontFamily,
      paddingVertical: 0,
    },
    searchActionButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    totalRow: {
      marginHorizontal: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    totalText: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      fontWeight: '700',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.base,
      textAlign: 'center',
    },
    listContent: {
      padding: theme.spacing.md,
      paddingBottom: 96,
      gap: theme.spacing.sm,
    },
    gridColumns: {
      gap: theme.spacing.sm,
    },
    card: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.md,
      gap: 6,
    },
    cardGrid: {
      flex: 1,
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
      color: theme.colors.background,
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
    fab: {
      position: 'absolute',
      right: theme.spacing.xl,
      bottom: theme.spacing.xl,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...theme.shadows.md,
    },
    backButton: {
      position: 'absolute',
      left: theme.spacing.md,
      bottom: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      ...theme.shadows.sm,
    },
    backButtonLabel: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: '600',
    },
  });
