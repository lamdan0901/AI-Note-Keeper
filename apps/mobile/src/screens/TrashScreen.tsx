import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ConvexHttpClient } from 'convex/browser';
import { getDb } from '../db/bootstrap';
import {
  listDeletedNotes,
  hardDeleteNote,
  hardDeleteAllInactive,
  type Note,
} from '../db/notesRepo';
import { restoreNoteOffline } from '../notes/editor';
import { syncNotes } from '../sync/noteSync';
import { type Theme, useTheme } from '../theme';
import { SyncProvider } from '../sync/syncManager';
import { api } from '../../../../convex/_generated/api';
import { NoteCard } from '../components/NoteCard';
import { SettingsDrawer } from '../components/SettingsDrawer';
import { useDebouncedValue } from '../../../../packages/shared/hooks/useDebouncedValue';
import type { Subscription } from '../../../../packages/shared/types/subscription';
import {
  emptySubscriptionTrash,
  permanentlyDeleteSubscription,
  restoreSubscription,
  useDeletedSubscriptions,
  useEmptySubscriptionTrash,
  usePermanentlyDeleteSubscription,
  useRestoreSubscription,
} from '../subscriptions/service';
import { formatPrice } from '../../../../packages/shared/utils/subscription';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const USER_ID = 'local-user';

function getDaysRemaining(deletedAt: number | undefined): number {
  if (!deletedAt) return 14;
  const elapsed = Date.now() - deletedAt;
  return Math.max(0, Math.ceil((FOURTEEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));
}

function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url);
}

type TrashScreenProps = {
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  onNavigateToNotes?: () => void;
  onNavigateToSubscriptions?: () => void;
  subscriptionsEnabled?: boolean;
};

type TrashTab = 'notes' | 'subscriptions';

type SubscriptionTrashMeta = {
  count: number;
  loading: boolean;
};

type SubscriptionTrashSectionProps = {
  viewMode: 'list' | 'grid';
  searchQuery: string;
  onMetaChange: (meta: SubscriptionTrashMeta) => void;
  onRegisterEmpty: (handler: () => void) => void;
};

const SubscriptionTrashSection = React.memo(function SubscriptionTrashSection({
  viewMode,
  searchQuery,
  onMetaChange,
  onRegisterEmpty,
}: SubscriptionTrashSectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const deletedSubscriptions = useDeletedSubscriptions(true);
  const restoreMutation = useRestoreSubscription();
  const deleteForeverMutation = usePermanentlyDeleteSubscription();
  const emptyTrashMutation = useEmptySubscriptionTrash();
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filtered = useMemo(() => {
    const list = deletedSubscriptions ?? [];
    if (!normalizedQuery) return list;
    return list.filter((item) => {
      const title = item.serviceName.toLowerCase();
      const notes = (item.notes ?? '').toLowerCase();
      return title.includes(normalizedQuery) || notes.includes(normalizedQuery);
    });
  }, [deletedSubscriptions, normalizedQuery]);

  useEffect(() => {
    onMetaChange({
      count: deletedSubscriptions?.length ?? 0,
      loading: deletedSubscriptions === undefined,
    });
  }, [deletedSubscriptions, onMetaChange]);

  const handleRestore = useCallback(
    (subscription: Subscription) => {
      void (async () => {
        try {
          await restoreSubscription(restoreMutation, subscription.id);
        } catch (e) {
          console.error('[Trash] Failed to restore subscription:', e);
          Alert.alert('Error', 'Failed to restore subscription.');
        }
      })();
    },
    [restoreMutation],
  );

  const handleDeleteForever = useCallback(
    (subscription: Subscription) => {
      void (async () => {
        try {
          await permanentlyDeleteSubscription(deleteForeverMutation, subscription.id);
        } catch (e) {
          console.error('[Trash] Failed to permanently delete subscription:', e);
          Alert.alert('Error', 'Failed to delete subscription.');
        }
      })();
    },
    [deleteForeverMutation],
  );

  const handleEmptySubscriptionsTrash = useCallback(() => {
    if (filtered.length === 0) return;
    Alert.alert(
      'Empty Trash',
      `Permanently delete ${filtered.length} subscription${filtered.length > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty Trash',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await emptySubscriptionTrash(emptyTrashMutation);
              } catch (e) {
                console.error('[Trash] Failed to empty subscription trash:', e);
                Alert.alert('Error', 'Failed to empty subscription trash.');
              }
            })();
          },
        },
      ],
    );
  }, [emptyTrashMutation, filtered.length]);

  useEffect(() => {
    onRegisterEmpty(handleEmptySubscriptionsTrash);
  }, [handleEmptySubscriptionsTrash, onRegisterEmpty]);

  if (deletedSubscriptions === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (filtered.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="card-outline" size={64} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>No deleted subscriptions</Text>
        <Text style={styles.emptySubtext}>
          Deleted subscriptions will appear here for 14 days before being permanently removed.
        </Text>
      </View>
    );
  }

  const renderSubscriptionCard = ({ item }: { item: Subscription }) => {
    const daysLeft = getDaysRemaining(item.deletedAt);
    return (
      <View style={[styles.subscriptionCard, viewMode === 'grid' && styles.subscriptionCardGrid]}>
        <View style={styles.subscriptionCardHeader}>
          <Text style={styles.subscriptionTitle} numberOfLines={1}>
            {item.serviceName}
          </Text>
          <Text style={styles.subscriptionPrice}>{formatPrice(item.price, item.currency)}</Text>
        </View>

        {!!item.notes && (
          <Text style={styles.subscriptionNotes} numberOfLines={2}>
            {item.notes}
          </Text>
        )}

        <View style={styles.subscriptionFooter}>
          <Text style={styles.trashDaysLabel}>
            {daysLeft === 0 ? 'Expiring today' : `${daysLeft}d left`}
          </Text>
          <View style={styles.subscriptionActions}>
            <Pressable onPress={() => handleRestore(item)} hitSlop={8}>
              <Ionicons name="arrow-undo-outline" size={18} color={theme.colors.primary} />
            </Pressable>
            <Pressable onPress={() => handleDeleteForever(item)} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  return (
    <FlatList
      key={viewMode}
      data={filtered}
      keyExtractor={(item) => item.id}
      numColumns={viewMode === 'grid' ? 2 : 1}
      contentContainerStyle={styles.listContent}
      columnWrapperStyle={viewMode === 'grid' ? styles.subscriptionGridColumns : undefined}
      renderItem={renderSubscriptionCard}
    />
  );
});

SubscriptionTrashSection.displayName = 'SubscriptionTrashSection';

type NotesTrashSectionProps = {
  loadingNotes: boolean;
  filteredNotes: Note[];
  isGrid: boolean;
  leftColumn: Note[];
  rightColumn: Note[];
  renderTrashCard: (note: Note) => JSX.Element;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
};

const NotesTrashSection = React.memo(function NotesTrashSection({
  loadingNotes,
  filteredNotes,
  isGrid,
  leftColumn,
  rightColumn,
  renderTrashCard,
  styles,
  theme,
}: NotesTrashSectionProps) {
  if (loadingNotes) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (filteredNotes.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="trash-outline" size={64} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>No deleted notes</Text>
        <Text style={styles.emptySubtext}>
          Deleted notes will appear here for 14 days before being permanently removed.
        </Text>
      </View>
    );
  }

  if (isGrid) {
    return (
      <FlatList
        key="grid"
        data={[{ key: 'masonry' }]}
        renderItem={() => (
          <View style={styles.masonryContainer}>
            <View style={styles.masonryColumn}>{leftColumn.map(renderTrashCard)}</View>
            <View style={styles.masonryColumn}>{rightColumn.map(renderTrashCard)}</View>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <FlatList
      key="list"
      data={filteredNotes}
      keyExtractor={(n) => n.id}
      renderItem={({ item }) => renderTrashCard(item)}
      contentContainerStyle={styles.listContent}
    />
  );
});

NotesTrashSection.displayName = 'NotesTrashSection';

const TrashScreenContent: React.FC<TrashScreenProps> = ({
  viewMode,
  onViewModeChange,
  onNavigateToNotes,
  onNavigateToSubscriptions,
  subscriptionsEnabled = false,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<TrashTab>('notes');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [subscriptionMeta, setSubscriptionMeta] = useState<SubscriptionTrashMeta>({
    count: 0,
    loading: false,
  });
  const subscriptionEmptyHandlerRef = useRef<() => void>(() => {});
  const inputRef = useRef<TextInput>(null);
  const drawerAnim = useRef(new Animated.Value(0)).current;

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
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleCollapseSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFocused(false);
    Keyboard.dismiss();
  }, []);

  const loadTrash = useCallback(async () => {
    try {
      const db = await getDb();
      const deleted = await listDeletedNotes(db);
      setNotes(deleted);
    } catch (e) {
      console.error('[Trash] Failed to load:', e);
    } finally {
      setLoadingNotes(false);
    }
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = useCallback(
    (note: Note) => {
      setNotes((prev) => prev.filter((n) => n.id !== note.id));

      void (async () => {
        try {
          const db = await getDb();
          await restoreNoteOffline(db, note);
          await syncNotes(db);
        } catch (e) {
          console.error('[Trash] Restore failed:', e);
          Alert.alert('Error', 'Failed to restore note');
          loadTrash();
        }
      })();
    },
    [loadTrash],
  );

  const handleDeleteForever = useCallback(
    (note: Note) => {
      setNotes((prev) => prev.filter((n) => n.id !== note.id));

      void (async () => {
        try {
          const client = getConvexClient();
          if (client) {
            await client.mutation(api.functions.notes.permanentlyDeleteNote, {
              userId: USER_ID,
              noteId: note.id,
            });
          }
          const db = await getDb();
          await hardDeleteNote(db, note.id);
        } catch (e) {
          console.error('[Trash] Permanent delete failed:', e);
          Alert.alert('Error', 'Failed to delete note. Check your connection.');
          loadTrash();
        }
      })();
    },
    [loadTrash],
  );

  const handleEmptyNotesTrash = useCallback(() => {
    if (notes.length === 0) return;
    Alert.alert(
      'Empty Trash',
      `Permanently delete ${notes.length} note${notes.length > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty Trash',
          style: 'destructive',
          onPress: () => {
            setNotes([]);

            void (async () => {
              try {
                const client = getConvexClient();
                if (client) {
                  await client.mutation(api.functions.notes.emptyTrash, { userId: USER_ID });
                }
                const db = await getDb();
                await hardDeleteAllInactive(db);
              } catch (e) {
                console.error('[Trash] Empty trash failed:', e);
                Alert.alert('Error', 'Failed to empty trash. Check your connection.');
                loadTrash();
              }
            })();
          },
        },
      ],
    );
  }, [notes.length, loadTrash]);

  const handleEmptyTrash = useCallback(() => {
    if (activeTab === 'notes') {
      handleEmptyNotesTrash();
      return;
    }
    subscriptionEmptyHandlerRef.current();
  }, [activeTab, handleEmptyNotesTrash]);

  const handleSubscriptionMetaChange = useCallback((meta: SubscriptionTrashMeta) => {
    setSubscriptionMeta((prev) => {
      if (prev.count === meta.count && prev.loading === meta.loading) {
        return prev;
      }
      return meta;
    });
  }, []);

  const handleRegisterSubscriptionEmpty = useCallback((handler: () => void) => {
    subscriptionEmptyHandlerRef.current = handler;
  }, []);

  const isGrid = viewMode === 'grid';
  const notesSectionActive = !subscriptionsEnabled || activeTab === 'notes';
  const normalizedQuery = debouncedSearchQuery.trim().toLowerCase();

  const filteredNotes = useMemo(() => {
    if (!normalizedQuery) return notes;
    return notes.filter((note) => {
      const title = (note.title ?? '').toLowerCase();
      const content = (note.content ?? '').toLowerCase();
      return title.includes(normalizedQuery) || content.includes(normalizedQuery);
    });
  }, [notes, normalizedQuery]);

  const { leftColumn, rightColumn } = useMemo(() => {
    const left: Note[] = [];
    const right: Note[] = [];
    filteredNotes.forEach((note, index) => {
      if (index % 2 === 0) left.push(note);
      else right.push(note);
    });
    return { leftColumn: left, rightColumn: right };
  }, [filteredNotes]);

  const renderTrashCard = useCallback(
    (note: Note) => {
      const daysLeft = getDaysRemaining(note.deletedAt);
      return (
        <NoteCard
          key={note.id}
          note={note}
          variant={viewMode}
          onPress={() => {}}
          selectionMode={false}
          isSelected={false}
          trashInfo={{
            daysRemaining: daysLeft,
            onRestore: () => handleRestore(note),
            onDeleteForever: () => handleDeleteForever(note),
            actionPending: false,
          }}
        />
      );
    },
    [viewMode, handleRestore, handleDeleteForever],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.iconButton} onPress={openDrawer} accessibilityLabel="Open menu">
            <Ionicons name="menu" size={26} color={theme.colors.text} />
          </Pressable>
          {!isSearchExpanded && <Text style={styles.headerTitle}>Trash</Text>}
        </View>

        <View style={styles.headerRight}>
          {isSearchExpanded ? (
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={16} color={theme.colors.textMuted} />
              <TextInput
                ref={inputRef}
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={activeTab === 'notes' ? 'Search notes' : 'Search subscriptions'}
                placeholderTextColor={theme.colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
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

          {(activeTab === 'notes' ? filteredNotes.length > 0 : subscriptionMeta.count > 0) && (
            <Pressable onPress={handleEmptyTrash} style={styles.emptyButton}>
              <Text style={styles.emptyTrashText}>Empty</Text>
            </Pressable>
          )}

          <Pressable
            style={styles.iconButton}
            onPress={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
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
        activeScreen="trash"
        onNotesPress={() => {
          closeDrawer();
          onNavigateToNotes?.();
        }}
        onTrashPress={closeDrawer}
        onSubscriptionsPress={() => {
          closeDrawer();
          onNavigateToSubscriptions?.();
        }}
        showSubscriptionsEntry={subscriptionsEnabled}
        showDueSubscriptionsIndicator={false}
      />

      <View style={styles.tabsRow}>
        <Pressable
          style={[styles.tabButton, activeTab === 'notes' && styles.tabButtonActive]}
          onPress={() => setActiveTab('notes')}
        >
          <Text style={[styles.tabLabel, activeTab === 'notes' && styles.tabLabelActive]}>
            Notes
          </Text>
        </Pressable>
        {subscriptionsEnabled && (
          <Pressable
            style={[styles.tabButton, activeTab === 'subscriptions' && styles.tabButtonActive]}
            onPress={() => setActiveTab('subscriptions')}
          >
            <Text style={[styles.tabLabel, activeTab === 'subscriptions' && styles.tabLabelActive]}>
              Subscriptions
            </Text>
          </Pressable>
        )}
      </View>

      {subscriptionsEnabled && (
        <View
          style={activeTab === 'subscriptions' ? styles.sectionVisible : styles.sectionHidden}
          pointerEvents={activeTab === 'subscriptions' ? 'auto' : 'none'}
        >
          <SubscriptionTrashSection
            viewMode={viewMode}
            searchQuery={debouncedSearchQuery}
            onMetaChange={handleSubscriptionMetaChange}
            onRegisterEmpty={handleRegisterSubscriptionEmpty}
          />
        </View>
      )}

      <View
        style={notesSectionActive ? styles.sectionVisible : styles.sectionHidden}
        pointerEvents={notesSectionActive ? 'auto' : 'none'}
      >
        <NotesTrashSection
          loadingNotes={loadingNotes}
          filteredNotes={filteredNotes}
          isGrid={isGrid}
          leftColumn={leftColumn}
          rightColumn={rightColumn}
          renderTrashCard={renderTrashCard}
          styles={styles}
          theme={theme}
        />
      </View>
    </SafeAreaView>
  );
};

export const TrashScreen: React.FC<TrashScreenProps> = (props) => (
  <SyncProvider>
    <TrashScreenContent {...props} />
  </SyncProvider>
);

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
    headerTitle: {
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
      fontFamily: theme.typography.fontFamily,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 1,
    },
    iconButton: {
      padding: theme.spacing.xs,
      position: 'relative',
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
    emptyButton: {
      paddingHorizontal: theme.spacing.xs,
    },
    emptyTrashText: {
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.semibold as '600',
      color: theme.colors.error,
    },
    tabsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
      backgroundColor: theme.colors.background,
    },
    tabButton: {
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.md,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    tabButtonActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    tabLabel: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.medium as '500',
    },
    tabLabelActive: {
      color: '#ffffff',
      fontWeight: theme.typography.weights.semibold as '600',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.xl,
      gap: theme.spacing.sm,
    },
    emptyText: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weights.semibold as '600',
      color: theme.colors.textMuted,
      marginTop: theme.spacing.md,
    },
    emptySubtext: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
    },
    listContent: {
      padding: theme.spacing.sm,
      gap: theme.spacing.sm,
      paddingBottom: 100,
    },
    masonryContainer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    masonryColumn: {
      flex: 1,
      gap: theme.spacing.sm,
    },
    subscriptionCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
      ...theme.shadows.sm,
    },
    subscriptionCardGrid: {
      minHeight: 0,
    },
    subscriptionCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    subscriptionTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.base,
      fontWeight: theme.typography.weights.semibold as '600',
    },
    subscriptionPrice: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.medium as '500',
    },
    subscriptionNotes: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
    },
    subscriptionFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: theme.spacing.xs,
    },
    subscriptionActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    subscriptionGridColumns: {
      gap: theme.spacing.sm,
    },
    trashDaysLabel: {
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.textMuted,
    },
    sectionVisible: {
      flex: 1,
    },
    sectionHidden: {
      ...StyleSheet.absoluteFillObject,
      opacity: 0,
    },
  });
