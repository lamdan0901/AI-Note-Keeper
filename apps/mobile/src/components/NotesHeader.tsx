import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { type Theme, useTheme } from '../theme';

type NotesHeaderProps = {
  viewMode: 'list' | 'grid';
  selectionMode: boolean;
  onViewModeToggle: () => void;
  onMenuPress: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  showDueSubscriptionsIndicator?: boolean;
};

export const NotesHeader: React.FC<NotesHeaderProps> = ({
  viewMode,
  selectionMode,
  onViewModeToggle,
  onMenuPress,
  searchQuery,
  onSearchQueryChange,
  showDueSubscriptionsIndicator = false,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const inputRef = useRef<TextInput>(null);
  const bumpAnim = useRef(new Animated.Value(0)).current;
  const [searchFocused, setSearchFocused] = useState(false);
  const hasSearchValue = searchQuery.trim().length > 0;
  const isSearchExpanded = hasSearchValue || searchFocused;

  const handleOpenSearch = () => {
    setSearchFocused(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleClearSearch = () => {
    onSearchQueryChange('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCollapseSearch = () => {
    onSearchQueryChange('');
    setSearchFocused(false);
    Keyboard.dismiss();
  };

  useEffect(() => {
    if (!showDueSubscriptionsIndicator) {
      bumpAnim.stopAnimation();
      bumpAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bumpAnim, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(bumpAnim, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [bumpAnim, showDueSubscriptionsIndicator]);

  return (
    <View style={[styles.header, selectionMode && styles.headerHidden]}>
      <View style={styles.headerLeft}>
        <Pressable style={styles.iconButton} onPress={onMenuPress}>
          <Ionicons name="menu" size={26} color={theme.colors.text} />
          {showDueSubscriptionsIndicator && (
            <Animated.View
              style={[
                styles.dueDot,
                {
                  opacity: bumpAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.55, 1],
                  }),
                  transform: [
                    {
                      scale: bumpAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.88, 1.12],
                      }),
                    },
                  ],
                },
              ]}
            />
          )}
        </Pressable>
        {!isSearchExpanded && <Text style={styles.headerTitle}>My Notes</Text>}
      </View>
      <View style={styles.headerRight}>
        <SyncStatusIndicator />
        {isSearchExpanded ? (
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={16} color={theme.colors.textMuted} />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={onSearchQueryChange}
              placeholder="Search notes"
              placeholderTextColor={theme.colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              accessibilityLabel="Search notes"
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
        <Pressable style={styles.iconButton} onPress={onViewModeToggle}>
          <Ionicons
            name={viewMode === 'grid' ? 'list' : 'grid'}
            size={24}
            color={theme.colors.primary}
          />
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    header: {
      padding: theme.spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
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
    dueDot: {
      position: 'absolute',
      right: 2,
      top: 2,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: theme.colors.cta,
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
    headerHidden: {
      opacity: 0,
    },
  });
