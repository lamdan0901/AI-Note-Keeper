import React, { useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme } from '../theme';
import { NOTE_COLOR_PRESETS, type NoteColorPreset } from '../constants/noteColors';

type ColorPickerProps = {
  selectedColorId: string;
  onColorSelect: (presetId: string) => void;
  theme: Theme;
  isDark: boolean;
};

export function ColorPicker({ selectedColorId, onColorSelect, theme, isDark }: ColorPickerProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);

  const handleColorPress = (preset: NoteColorPreset) => {
    onColorSelect(preset.id);
  };

  return (
    <View style={styles.container}>
      {NOTE_COLOR_PRESETS.map((preset) => {
        const isSelected = selectedColorId === preset.id;
        const displayColor =
          preset.id === 'default'
            ? theme.colors.surface
            : isDark
              ? preset.darkColor
              : preset.lightColor;

        return (
          <Pressable
            key={preset.id}
            onPress={() => handleColorPress(preset)}
            style={({ pressed }) => [
              styles.colorButton,
              {
                backgroundColor: displayColor,
                borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                borderWidth: isSelected ? 2 : 1,
                transform: [{ scale: pressed ? 0.9 : 1 }],
              },
            ]}
          >
            {isSelected && <Ionicons name="checkmark" size={20} color={theme.colors.primary} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: theme.spacing.sm,
    },
    colorButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      ...theme.shadows.sm,
    },
  });
