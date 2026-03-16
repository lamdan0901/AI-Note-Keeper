import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChecklistItem } from '../../../../packages/shared/types/note';
import { newChecklistItem } from '../../../../packages/shared/utils/checklist';
import { type Theme } from '../theme';

interface ChecklistEditorProps {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  theme: Theme;
  textColor: string;
  mutedTextColor: string;
}

export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({
  items,
  onChange,
  theme,
  textColor,
  mutedTextColor,
}) => {
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const inputRefs = useRef<Map<string, TextInput>>(new Map());
  const lastAddedIdRef = useRef<string | null>(null);

  const toggleItem = (id: string) => {
    onChange(items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)));
  };

  const updateText = (id: string, text: string) => {
    onChange(items.map((item) => (item.id === id ? { ...item, text } : item)));
  };

  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  const addItem = () => {
    const item = newChecklistItem();
    lastAddedIdRef.current = item.id;
    onChange([...items, item]);
    // Focus new item after render
    setTimeout(() => inputRefs.current.get(item.id)?.focus(), 50);
  };

  const handleSubmitEditing = () => {
    addItem();
  };

  return (
    <View style={styles.container}>
      {items.map((item) => (
        <View key={item.id} style={styles.item}>
          <Pressable onPress={() => toggleItem(item.id)} style={styles.checkboxArea} hitSlop={8}>
            <Ionicons
              name={item.checked ? 'checkbox' : 'square-outline'}
              size={22}
              color={item.checked ? theme.colors.primary : mutedTextColor}
            />
          </Pressable>
          <TextInput
            ref={(el) => {
              if (el) inputRefs.current.set(item.id, el);
              else inputRefs.current.delete(item.id);
            }}
            style={[styles.textInput, { color: textColor }, item.checked && styles.checkedText]}
            value={item.text}
            onChangeText={(text) => updateText(item.id, text)}
            onSubmitEditing={handleSubmitEditing}
            placeholder="List item"
            placeholderTextColor={mutedTextColor}
            blurOnSubmit={false}
            returnKeyType="next"
          />
          <Pressable onPress={() => removeItem(item.id)} style={styles.removeBtn} hitSlop={8}>
            <Ionicons name="close" size={18} color={mutedTextColor} />
          </Pressable>
        </View>
      ))}
      <Pressable onPress={addItem} style={styles.addBtn}>
        <Ionicons name="add" size={20} color={mutedTextColor} />
        <Text style={[styles.addText, { color: mutedTextColor }]}>Add item</Text>
      </Pressable>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      paddingVertical: theme.spacing.xs,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    checkboxArea: {
      justifyContent: 'center',
      alignItems: 'center',
      width: 28,
    },
    textInput: {
      flex: 1,
      fontSize: theme.typography.sizes.base,
      paddingVertical: 4,
      textDecorationLine: 'none',
    },
    checkedText: {
      textDecorationLine: 'line-through',
      opacity: 0.5,
    },
    removeBtn: {
      padding: 4,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 8,
      paddingLeft: 2,
    },
    addText: {
      fontSize: theme.typography.sizes.sm,
    },
  });
