import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { SubscriptionEditorModal } from '../components/subscriptions/SubscriptionEditorModal';
import {
  createSubscription,
  deleteSubscription,
  updateSubscription,
  useCreateSubscription,
  useDeleteSubscription,
  useSubscriptions,
  useUpdateSubscription,
} from '../subscriptions/service';
import {
  SubscriptionSelectionActionBar,
} from '../components/subscriptions/SubscriptionSelectionActionBar';
import { useSubscriptionSelection } from '../hooks/useSubscriptionSelection';
import {
  computeTotalMonthlyCost,
  formatBillingCycle,
  formatPrice,
  getDaysUntilBilling,
} from '../../../../packages/shared/utils/subscription';
import { useUserId } from '../auth/useUserId';

type ViewMode = 'grid' | 'list';
const TEMP_SUBSCRIPTION_ID_PREFIX = 'temp-subscription:';

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

type SubscriptionsScreenProps = {
  onSelectionModeChange?: (isActive: boolean) => void;
};

export const SubscriptionsScreen = (props: SubscriptionsScreenProps) => {
  const userId = useUserId();
  const { theme, resolvedMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const subscriptions = useSubscriptions();
  const createMutate = useCreateSubscription();
  const updateMutate = useUpdateSubscription();
  const deleteMutate = useDeleteSubscription();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [optimisticSubscriptions, setOptimisticSubscriptions] = useState<
    Record<string, Subscription>
  >({});
  const [optimisticDeletedIds, setOptimisticDeletedIds] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<TextInput>(null);
  const latestSaveOpByIdRef = useRef<Record<string, string>>({});
  const pendingTempCreateIdsRef = useRef<Set<string>>(new Set());
  const canceledTempCreateIdsRef = useRef<Set<string>>(new Set());
  const tempToCreatedIdRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!subscriptions) return;

    const serverById = new Map(subscriptions.map((item) => [item.id, item]));
    setOptimisticSubscriptions((prev) => {
      let changed = false;
      const next: Record<string, Subscription> = { ...prev };

      Object.entries(prev).forEach(([id, optimistic]) => {
        if (id.startsWith(TEMP_SUBSCRIPTION_ID_PREFIX)) return;
        const serverItem = serverById.get(id);
        if (!serverItem) return;

        if (serverItem.updatedAt >= optimistic.updatedAt) {
          delete next[id];
          changed = true;
        }
      });

      return changed ? next : prev;
    });

    const activeServerIds = new Set(subscriptions.map((item) => item.id));
    setOptimisticDeletedIds((prev) => {
      let changed = false;
      const next = new Set<string>();

      prev.forEach((id) => {
        if (id.startsWith(TEMP_SUBSCRIPTION_ID_PREFIX) || activeServerIds.has(id)) {
          next.add(id);
          return;
        }
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [subscriptions]);

  const hasSearchValue = searchQuery.trim().length > 0;
  const isSearchExpanded = hasSearchValue || searchFocused;

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
          const operationId = `${editingSubscription.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
          latestSaveOpByIdRef.current = {
            ...latestSaveOpByIdRef.current,
            [editingSubscription.id]: operationId,
          };

          const previous =
            subscriptions?.find((item) => item.id === editingSubscription.id) ?? null;
          if (!previous) {
            throw new Error('Subscription not found for optimistic update');
          }

          const optimisticNext: Subscription = {
            ...previous,
            ...(data as SubscriptionUpdate),
            updatedAt: Date.now(),
          };

          setOptimisticSubscriptions((prev) => ({
            ...prev,
            [editingSubscription.id]: optimisticNext,
          }));
          setEditorVisible(false);
          setEditingSubscription(null);

          try {
            await updateSubscription(
              updateMutate,
              editingSubscription.id,
              data as SubscriptionUpdate,
            );
          } catch {
            if (latestSaveOpByIdRef.current[editingSubscription.id] !== operationId) {
              return;
            }

            setOptimisticSubscriptions((prev) => {
              const next = { ...prev };
              if (previous) next[editingSubscription.id] = previous;
              else delete next[editingSubscription.id];
              return next;
            });
            Alert.alert('Save failed', 'Unable to save subscription. Please try again.');
          } finally {
            if (latestSaveOpByIdRef.current[editingSubscription.id] === operationId) {
              const { [editingSubscription.id]: removed, ...rest } = latestSaveOpByIdRef.current;
              void removed;
              latestSaveOpByIdRef.current = rest;
            }
          }
        } else {
          const payload = data as SubscriptionCreate;
          const tempId = `${TEMP_SUBSCRIPTION_ID_PREFIX}${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
          const now = Date.now();
          pendingTempCreateIdsRef.current = new Set(pendingTempCreateIdsRef.current).add(tempId);
          const optimisticCreated: Subscription = {
            id: tempId,
            userId: payload.userId,
            serviceName: payload.serviceName,
            category: payload.category,
            price: payload.price,
            currency: payload.currency,
            billingCycle: payload.billingCycle,
            billingCycleCustomDays: payload.billingCycleCustomDays,
            nextBillingDate: payload.nextBillingDate,
            notes: payload.notes,
            trialEndDate: payload.trialEndDate,
            status: payload.status,
            reminderDaysBefore: payload.reminderDaysBefore,
            nextReminderAt: undefined,
            lastNotifiedBillingDate: undefined,
            nextTrialReminderAt: undefined,
            lastNotifiedTrialEndDate: undefined,
            active: true,
            deletedAt: undefined,
            createdAt: now,
            updatedAt: now,
          };

          setOptimisticSubscriptions((prev) => ({
            ...prev,
            [tempId]: optimisticCreated,
          }));
          setEditorVisible(false);
          setEditingSubscription(null);

          try {
            const createdId = await createSubscription(createMutate, payload);
            tempToCreatedIdRef.current = {
              ...tempToCreatedIdRef.current,
              [tempId]: createdId,
            };

            if (canceledTempCreateIdsRef.current.has(tempId)) {
              try {
                await deleteSubscription(deleteMutate, createdId);
              } catch {
                Alert.alert(
                  'Delete failed',
                  'Unable to delete selected subscriptions. Please try again.',
                );
              }

              const nextCanceled = new Set(canceledTempCreateIdsRef.current);
              nextCanceled.delete(tempId);
              canceledTempCreateIdsRef.current = nextCanceled;
            }

            setOptimisticSubscriptions((prev) => {
              const temp = prev[tempId];
              if (!temp) return prev;

              if (canceledTempCreateIdsRef.current.has(tempId)) {
                const next = { ...prev };
                delete next[tempId];
                return next;
              }

              const next = { ...prev };
              delete next[tempId];
              next[createdId] = { ...temp, id: createdId };
              return next;
            });
            setOptimisticDeletedIds((prev) => {
              if (!prev.has(tempId)) return prev;
              const next = new Set(prev);
              next.delete(tempId);
              return next;
            });
          } catch {
            setOptimisticSubscriptions((prev) => {
              const next = { ...prev };
              delete next[tempId];
              return next;
            });
            setOptimisticDeletedIds((prev) => {
              if (!prev.has(tempId)) return prev;
              const next = new Set(prev);
              next.delete(tempId);
              return next;
            });
            Alert.alert('Save failed', 'Unable to save subscription. Please try again.');
          } finally {
            const nextPending = new Set(pendingTempCreateIdsRef.current);
            nextPending.delete(tempId);
            pendingTempCreateIdsRef.current = nextPending;

            const nextCanceled = new Set(canceledTempCreateIdsRef.current);
            nextCanceled.delete(tempId);
            canceledTempCreateIdsRef.current = nextCanceled;

            const { [tempId]: removedCreatedId, ...remainingMap } = tempToCreatedIdRef.current;
            void removedCreatedId;
            tempToCreatedIdRef.current = remainingMap;
          }
        }
      } catch {
        Alert.alert('Save failed', 'Unable to save subscription. Please try again.');
      } finally {
        setSavingSubscription(false);
      }
    },
    [
      createMutate,
      deleteMutate,
      editingSubscription,
      subscriptions,
      updateMutate,
      latestSaveOpByIdRef,
    ],
  );

  const list = useMemo(() => {
    const serverItems = subscriptions ?? [];
    const serverIds = new Set(serverItems.map((item) => item.id));

    const optimisticCreated = Object.values(optimisticSubscriptions)
      .filter(
        (item) =>
          !serverIds.has(item.id) && !optimisticDeletedIds.has(item.id) && item.active !== false,
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    const mergedServerItems = serverItems
      .filter((item) => !optimisticDeletedIds.has(item.id))
      .map((item) => optimisticSubscriptions[item.id] ?? item)
      .filter((item) => item.active !== false);

    return [...optimisticCreated, ...mergedServerItems];
  }, [optimisticDeletedIds, optimisticSubscriptions, subscriptions]);
  const {
    selectedSubscriptionIds,
    selectionMode,
    selectionHeaderAnim,
    clearSelection,
    removeSelectedSubscriptionIds,
    handleSubscriptionLongPress,
  } = useSubscriptionSelection(list, props.onSelectionModeChange);
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

  const estimateCardHeight = useCallback((item: Subscription) => {
    // Approximate per-card height to keep masonry columns visually balanced.
    const baseHeight = 132;
    const titleLines = Math.max(1, Math.ceil(item.serviceName.trim().length / 24));
    const categoryLines = Math.max(1, Math.ceil(formatSubCategory(item.category).length / 22));
    const notesLines = item.notes ? Math.min(3, Math.ceil(item.notes.trim().length / 30)) : 0;
    const countdownHeight = item.status === 'active' ? 24 : 0;

    return baseHeight + titleLines * 18 + categoryLines * 14 + notesLines * 14 + countdownHeight;
  }, []);

  const { leftColumn, rightColumn } = useMemo(() => {
    const left: Subscription[] = [];
    const right: Subscription[] = [];
    let leftHeight = 0;
    let rightHeight = 0;

    filtered.forEach((item) => {
      const estimatedHeight = estimateCardHeight(item);

      if (leftHeight <= rightHeight) {
        left.push(item);
        leftHeight += estimatedHeight;
      } else {
        right.push(item);
        rightHeight += estimatedHeight;
      }
    });

    return { leftColumn: left, rightColumn: right };
  }, [estimateCardHeight, filtered]);

  const totalMonthly = computeTotalMonthlyCost(list);
  const primaryCurrency = list[0]?.currency ?? 'USD';

  const handleSelectionAwareDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return true;
      const targetIds = Array.from(new Set(ids));

      setOptimisticDeletedIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.add(id));
        return next;
      });

      const localOnlyIds = targetIds.filter((id) => id.startsWith(TEMP_SUBSCRIPTION_ID_PREFIX));
      const mappedRemoteIds = localOnlyIds
        .map((id) => tempToCreatedIdRef.current[id])
        .filter((id): id is string => Boolean(id));

      if (localOnlyIds.length > 0) {
        const pendingTempIds = pendingTempCreateIdsRef.current;
        const nextCanceled = new Set(canceledTempCreateIdsRef.current);
        localOnlyIds.forEach((id) => {
          if (pendingTempIds.has(id)) {
            nextCanceled.add(id);
          }
        });
        canceledTempCreateIdsRef.current = nextCanceled;

        setOptimisticSubscriptions((prev) => {
          const next = { ...prev };
          localOnlyIds.forEach((id) => {
            delete next[id];
          });
          return next;
        });
      }

      const remoteIds = Array.from(
        new Set([
          ...targetIds.filter((id) => !id.startsWith(TEMP_SUBSCRIPTION_ID_PREFIX)),
          ...mappedRemoteIds,
        ]),
      );
      if (remoteIds.length === 0) {
        removeSelectedSubscriptionIds(targetIds);
        return true;
      }

      const deletionResults = await Promise.allSettled(
        remoteIds.map((id) => deleteSubscription(deleteMutate, id)),
      );
      const failedRemoteIds = remoteIds.filter(
        (_, index) => deletionResults[index]?.status === 'rejected',
      );

      if (failedRemoteIds.length > 0) {
        setOptimisticDeletedIds((prev) => {
          const next = new Set(prev);
          failedRemoteIds.forEach((id) => next.delete(id));
          return next;
        });

        Alert.alert('Delete failed', 'Unable to delete selected subscriptions. Please try again.');
      }

      const succeededIds = targetIds.filter((id) => !failedRemoteIds.includes(id));
      removeSelectedSubscriptionIds(succeededIds);

      localOnlyIds.forEach((id) => {
        const mappedId = tempToCreatedIdRef.current[id];
        if (!mappedId || failedRemoteIds.includes(mappedId)) return;

        const { [id]: removedCreatedId, ...remainingMap } = tempToCreatedIdRef.current;
        void removedCreatedId;
        tempToCreatedIdRef.current = remainingMap;
      });

      if (localOnlyIds.length > 0) {
        setOptimisticDeletedIds((prev) => {
          const next = new Set(prev);
          localOnlyIds.forEach((id) => next.delete(id));
          return next;
        });
      }

      return failedRemoteIds.length === 0;
    },
    [deleteMutate, removeSelectedSubscriptionIds],
  );

  const handleBulkDeleteSelected = useCallback(() => {
    void handleSelectionAwareDelete(Array.from(selectedSubscriptionIds));
  }, [handleSelectionAwareDelete, selectedSubscriptionIds]);

  const handleDeleteEditingSubscription = useCallback(() => {
    if (!editingSubscription || savingSubscription) return;

    const deletingId = editingSubscription.id;
    setEditorVisible(false);
    setEditingSubscription(null);

    void handleSelectionAwareDelete([deletingId]);
  }, [editingSubscription, handleSelectionAwareDelete, savingSubscription]);

  const handleCardPress = useCallback(
    (subscription: Subscription) => {
      if (selectionMode) {
        handleSubscriptionLongPress(subscription.id);
        return;
      }
      handleOpenEdit(subscription);
    },
    [handleOpenEdit, handleSubscriptionLongPress, selectionMode],
  );

  const renderSubscriptionCard = useCallback(
    (item: Subscription, variant: ViewMode) => {
      const daysUntil = getDaysUntilBilling(item.nextBillingDate);
      const nextBillingLabel =
        daysUntil < 0 ? 'Overdue' : daysUntil === 0 ? 'Today' : `${daysUntil}d left`;
      const countdownTone =
        daysUntil < 0 ? 'overdue' : daysUntil <= 3 ? 'urgent' : daysUntil <= 7 ? 'warning' : 'ok';
      const isDarkMode = resolvedMode === 'dark';
      const isSelected = selectedSubscriptionIds.has(item.id);

      return (
        <Pressable
          key={item.id}
          style={[
            styles.card,
            variant === 'grid' && styles.cardGrid,
            isSelected && styles.cardSelected,
          ]}
          onPress={() => handleCardPress(item)}
          onLongPress={() => handleSubscriptionLongPress(item.id)}
          delayLongPress={250}
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle}>{item.serviceName}</Text>
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
    },
    [
      handleCardPress,
      handleSubscriptionLongPress,
      resolvedMode,
      selectedSubscriptionIds,
      styles.card,
      styles.cardCategory,
      styles.cardCountdownChip,
      styles.cardCountdownOk,
      styles.cardCountdownOkDark,
      styles.cardCountdownText,
      styles.cardCountdownTextOk,
      styles.cardCountdownTextOkDark,
      styles.cardCountdownTextUrgent,
      styles.cardCountdownTextUrgentDark,
      styles.cardCountdownTextWarning,
      styles.cardCountdownTextWarningDark,
      styles.cardCountdownUrgent,
      styles.cardCountdownUrgentDark,
      styles.cardCountdownWarning,
      styles.cardCountdownWarningDark,
      styles.cardCycle,
      styles.cardGrid,
      styles.cardPrice,
      styles.cardPricingLine,
      styles.cardSelected,
      styles.cardTitle,
      styles.cardTop,
      styles.statusActive,
      styles.statusCancelled,
      styles.statusDot,
      styles.statusPaused,
    ],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
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

      <SubscriptionSelectionActionBar
        selectionHeaderAnim={selectionHeaderAnim}
        selectedCount={selectedSubscriptionIds.size}
        onCancel={clearSelection}
        onDelete={handleBulkDeleteSelected}
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
        <Pressable
          style={styles.contentPressable}
          onPress={clearSelection}
          disabled={!selectionMode}
        >
          {viewMode === 'grid' ? (
            <FlatList
              key="grid"
              data={[{ key: 'masonry' }]}
              renderItem={() => (
                <View style={styles.masonryContainer}>
                  <View style={styles.masonryColumn}>
                    {leftColumn.map((item) => renderSubscriptionCard(item, 'grid'))}
                  </View>
                  <View style={styles.masonryColumn}>
                    {rightColumn.map((item) => renderSubscriptionCard(item, 'grid'))}
                  </View>
                </View>
              )}
              contentContainerStyle={styles.listContent}
            />
          ) : (
            <FlatList
              key="list"
              data={filtered}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => renderSubscriptionCard(item, 'list')}
            />
          )}
        </Pressable>
      )}

      <Animated.View style={[styles.fabContainer]}>
        <Pressable
          style={styles.fab}
          onPress={handleOpenNew}
          accessibilityLabel="Create subscription"
        >
          <Ionicons name="add" size={26} color="white" />
        </Pressable>
      </Animated.View>

      <SubscriptionEditorModal
        visible={editorVisible}
        userId={userId}
        subscription={editingSubscription}
        existingCategories={existingCategories}
        saving={savingSubscription}
        onClose={handleCloseEditor}
        onDelete={handleDeleteEditingSubscription}
        onSave={handleSaveSubscription}
      />
    </SafeAreaView>
  );
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
      paddingBottom: 132,
      gap: theme.spacing.sm,
    },
    masonryContainer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    masonryColumn: {
      flex: 1,
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
    cardSelected: {
      borderColor: theme.colors.primary,
      borderWidth: 2,
    },
    cardGrid: {
      // Removing flex: 1 so cards don't stretch vertically to fill the column height
    },
    contentPressable: {
      flex: 1,
    },
    fabContainer: {
      position: 'absolute',
      right: theme.spacing.xl,
      bottom: 100,
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
    fab: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...theme.shadows.md,
    },
  });
