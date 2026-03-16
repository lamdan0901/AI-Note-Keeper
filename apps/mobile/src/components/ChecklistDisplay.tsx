import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChecklistItem } from '../../../../packages/shared/types/note';
import { type Theme } from '../theme';

interface ChecklistDisplayProps {
  items: ChecklistItem[];
  maxItems?: number;
  theme: Theme;
  textColor: string;
  mutedTextColor: string;
  isDone?: boolean;
}

export const ChecklistDisplay: React.FC<ChecklistDisplayProps> = ({
  items,
  maxItems = 5,
  theme,
  textColor,
  mutedTextColor,
  isDone = false,
}) => {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const visible = maxItems > 0 ? items.slice(0, maxItems) : items;
  const remaining = items.length - visible.length;

  return (
    <View style={styles.container}>
      {visible.map((item) => (
        <View key={item.id} style={styles.item}>
          <Ionicons
            name={item.checked ? 'checkbox' : 'square-outline'}
            size={14}
            color={item.checked ? theme.colors.primary : mutedTextColor}
            style={{ paddingTop: 3.25 }}
          />
          <Text
            style={[
              styles.text,
              { color: item.checked ? mutedTextColor : textColor },
              (item.checked || isDone) && styles.checkedText,
            ]}
          >
            {item.text}
          </Text>
        </View>
      ))}
      {remaining > 0 && (
        <Text style={[styles.more, { color: mutedTextColor }]}>+{remaining} more</Text>
      )}
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: 2,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      paddingVertical: 1,
    },
    text: {
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
      flex: 1,
    },
    checkedText: {
      textDecorationLine: 'line-through',
      opacity: 0.5,
    },
    more: {
      fontSize: theme.typography.sizes.xs,
      paddingTop: 2,
    },
  });
