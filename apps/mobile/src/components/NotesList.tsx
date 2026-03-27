import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  Text,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { type Note } from '../db/notesRepo';
import { NoteCard } from './NoteCard';
import { type Theme, useTheme } from '../theme';
import { parseChecklist } from '../../../../packages/shared/utils/checklist';

// Estimate card height for balanced masonry column distribution.
// Values are approximate pixel heights matching NoteCard's rendered layout.
const GRID_CHARS_PER_LINE = 22; // ~card width 155px at font-size 14
const estimateNoteHeight = (note: Note): number => {
  const PADDING = 32; // top + bottom card padding
  const TITLE_LINE_HEIGHT = 22;
  const CONTENT_LINE_HEIGHT = 20;
  const CHECKLIST_ITEM_HEIGHT = 26;
  const REMINDER_HEIGHT = 38; // metaRow + badge

  let height = PADDING;

  const title = note.title?.trim() ?? '';
  if (title) {
    const lines = Math.max(1, Math.ceil(title.length / GRID_CHARS_PER_LINE));
    height += lines * TITLE_LINE_HEIGHT + 8; // 8 = marginBottom xs
  }

  const content = note.content?.trim() ?? '';
  if (content) {
    if (note.contentType === 'checklist') {
      const items = parseChecklist(content);
      height += Math.min(items.length, 6) * CHECKLIST_ITEM_HEIGHT; // maxItems=6 in grid
    } else {
      const lines = Math.max(1, Math.ceil(content.length / GRID_CHARS_PER_LINE));
      height += Math.min(lines, 8) * CONTENT_LINE_HEIGHT;
    }
  }

  const effectiveTriggerAt = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;
  if (effectiveTriggerAt) {
    height += REMINDER_HEIGHT;
  }

  return height;
};

const distributeIntoColumns = (notes: Note[]): { left: Note[]; right: Note[] } => {
  const left: Note[] = [];
  const right: Note[] = [];
  let leftHeight = 0;
  let rightHeight = 0;

  for (const note of notes) {
    const h = estimateNoteHeight(note);
    if (leftHeight <= rightHeight) {
      left.push(note);
      leftHeight += h;
    } else {
      right.push(note);
      rightHeight += h;
    }
  }

  return { left, right };
};

interface NotesListProps {
  notes: Note[];
  viewMode: 'list' | 'grid';
  onNotePress: (noteId: string) => void;
  onNoteLongPress: (noteId: string) => void;
  selectionMode: boolean;
  selectedNoteIds: Set<string>;
  onRefresh?: () => void;
  refreshing?: boolean;
  searchQuery?: string;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listRef?: React.RefObject<FlatList<any>>;
}

export const NotesList: React.FC<NotesListProps> = ({
  notes,
  viewMode,
  onNotePress,
  onNoteLongPress,
  selectionMode,
  selectedNoteIds,
  onRefresh,
  refreshing,
  searchQuery = '',
  onScroll,
  scrollEventThrottle,
  listRef,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isGrid = viewMode === 'grid';

  const { pinnedNotes, otherNotes } = useMemo(() => {
    const pinned: Note[] = [];
    const others: Note[] = [];
    notes.forEach((note) => {
      if (note.isPinned) {
        pinned.push(note);
      } else {
        others.push(note);
      }
    });
    return { pinnedNotes: pinned, otherNotes: others };
  }, [notes]);

  // Distribute notes into two columns for masonry layout (Google Keep style)
  const { leftColumn, rightColumn } = useMemo(() => {
    const { left, right } = distributeIntoColumns(otherNotes);
    return { leftColumn: left, rightColumn: right };
  }, [otherNotes]);

  const { pinnedLeft, pinnedRight } = useMemo(() => {
    const { left, right } = distributeIntoColumns(pinnedNotes);
    return { pinnedLeft: left, pinnedRight: right };
  }, [pinnedNotes]);

  const renderNote = useCallback(
    (item: Note) => (
      <NoteCard
        key={item.id}
        note={item}
        variant={viewMode}
        onPress={onNotePress}
        onLongPress={onNoteLongPress}
        selectionMode={selectionMode}
        isSelected={selectedNoteIds.has(item.id)}
      />
    ),
    [onNoteLongPress, onNotePress, selectedNoteIds, selectionMode, viewMode],
  );

  const renderPinnedSection = useCallback(() => {
    if (pinnedNotes.length === 0) return null;

    if (isGrid) {
      return (
        <View>
          <Text style={styles.sectionHeader}>Pinned</Text>
          <View style={styles.masonryContainer}>
            <View style={styles.masonryColumn}>{pinnedLeft.map(renderNote)}</View>
            <View style={styles.masonryColumn}>{pinnedRight.map(renderNote)}</View>
          </View>
          <Text style={styles.sectionHeader}>Others</Text>
        </View>
      );
    }

    return (
      <View>
        <Text style={styles.sectionHeader}>Pinned</Text>
        <View style={styles.listContainer}>{pinnedNotes.map(renderNote)}</View>
        <Text style={styles.sectionHeader}>Others</Text>
      </View>
    );
  }, [isGrid, pinnedLeft, pinnedNotes, pinnedRight, renderNote, styles]);

  const renderListItem = useCallback(({ item }: { item: Note }) => renderNote(item), [renderNote]);
  const keyExtractor = useCallback((item: Note) => item.id, []);

  if (notes.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {searchQuery.trim() ? 'No matching notes found.' : 'No notes yet. Create one!'}
        </Text>
      </View>
    );
  }

  // Masonry layout for grid view
  if (isGrid) {
    return (
      <FlatList
        key={viewMode}
        data={[{ key: 'masonry' }]}
        renderItem={() => (
          <View style={styles.masonryContainer}>
            <View style={styles.masonryColumn}>{leftColumn.map(renderNote)}</View>
            <View style={styles.masonryColumn}>{rightColumn.map(renderNote)}</View>
          </View>
        )}
        ListHeaderComponent={renderPinnedSection}
        contentContainerStyle={styles.listContent}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        ref={listRef}
      />
    );
  }

  // List view remains unchanged
  return (
    <FlatList
      key={viewMode}
      data={otherNotes}
      ListHeaderComponent={renderPinnedSection}
      renderItem={renderListItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      ref={listRef}
    />
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    listContent: {
      padding: theme.spacing.sm,
      gap: theme.spacing.sm,
      paddingBottom: 100,
    },
    sectionHeader: {
      fontSize: theme.typography.sizes.xs,
      fontWeight: '600',
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
      marginLeft: 4,
      textTransform: 'uppercase',
    },
    masonryContainer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    masonryColumn: {
      flex: 1,
      gap: theme.spacing.sm,
    },
    listContainer: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.xl,
    },
    emptyText: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.textMuted,
      fontFamily: theme.typography.fontFamily,
    },
  });
