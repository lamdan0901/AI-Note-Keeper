import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
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
  onBack: () => void;
  viewMode: 'list' | 'grid';
};

const TrashScreenContent: React.FC<TrashScreenProps> = ({ onBack, viewMode }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTrash = useCallback(async () => {
    try {
      const db = await getDb();
      const deleted = await listDeletedNotes(db);
      setNotes(deleted);
    } catch (e) {
      console.error('[Trash] Failed to load:', e);
    } finally {
      setLoading(false);
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

  const handleEmptyTrash = useCallback(() => {
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

  const isGrid = viewMode === 'grid';

  const { leftColumn, rightColumn } = useMemo(() => {
    const left: Note[] = [];
    const right: Note[] = [];
    notes.forEach((note, index) => {
      if (index % 2 === 0) left.push(note);
      else right.push(note);
    });
    return { leftColumn: left, rightColumn: right };
  }, [notes]);

  const renderTrashCard = (note: Note) => {
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
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Trash</Text>
        <View style={styles.headerRight}>
          {notes.length > 0 && (
            <Pressable onPress={handleEmptyTrash}>
              <Text style={styles.emptyTrashText}>Empty Trash</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : notes.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="trash-outline" size={64} color={theme.colors.textMuted} />
          <Text style={styles.emptyText}>No deleted notes</Text>
          <Text style={styles.emptySubtext}>
            Deleted notes will appear here for 14 days before being permanently removed.
          </Text>
        </View>
      ) : isGrid ? (
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
      ) : (
        <FlatList
          key="list"
          data={notes}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => renderTrashCard(item)}
          contentContainerStyle={styles.listContent}
        />
      )}
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
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    backButton: {
      padding: theme.spacing.xs,
      marginRight: theme.spacing.sm,
    },
    headerTitle: {
      flex: 1,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    emptyTrashText: {
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.semibold as '600',
      color: theme.colors.error,
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
  });
