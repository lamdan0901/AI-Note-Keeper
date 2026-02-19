import React, { useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme, useTheme } from '../theme';

const themeOptions = [
  { key: 'light', label: 'Light', description: 'Always light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', description: 'Always dark', icon: 'moon-outline' },
  {
    key: 'auto',
    label: 'Auto',
    description: 'Follow system',
    icon: 'desktop-outline',
  },
] as const;

type SettingsDrawerProps = {
  visible: boolean;
  onClose: () => void;
  drawerAnim: Animated.Value;
};

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ visible, onClose, drawerAnim }) => {
  const { theme, mode, setMode } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const drawerWidth = Math.min(320, Math.round(width * 0.82));
  const drawerTranslateX = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-drawerWidth, 0],
  });
  const drawerOverlayOpacity = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.4],
  });

  return (
    <>
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[styles.drawerOverlay, { opacity: drawerOverlayOpacity }]}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>

      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[
          styles.drawer,
          {
            width: drawerWidth,
            transform: [{ translateX: drawerTranslateX }],
          },
        ]}
      >
        <View style={styles.drawerContent}>
          <Text style={styles.drawerTitle}>AI Note Keeper</Text>
          <View style={styles.drawerSection}>
            <Text style={styles.drawerSectionTitle}>Settings</Text>
            <Text style={styles.drawerSectionSubtitle}>Theme</Text>
            <View style={styles.themeOptions}>
              {themeOptions.map((option) => {
                const isSelected = mode === option.key;
                return (
                  <Pressable
                    key={option.key}
                    style={[styles.themeOption, isSelected && styles.themeOptionSelected]}
                    onPress={() => setMode(option.key)}
                  >
                    <View style={styles.themeOptionLeft}>
                      <Ionicons
                        name={option.icon}
                        size={20}
                        color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                      />
                      <View>
                        <Text style={styles.themeOptionLabel}>{option.label}</Text>
                        <Text style={styles.themeOptionDescription}>{option.description}</Text>
                      </View>
                    </View>
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Animated.View>
    </>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    drawerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000000',
      zIndex: 1200,
    },
    drawer: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: theme.colors.surface,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
      zIndex: 1300,
      paddingTop: theme.spacing.lg,
    },
    drawerContent: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
      gap: theme.spacing.lg,
    },
    drawerTitle: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
    },
    drawerSection: {
      gap: theme.spacing.sm,
    },
    drawerSectionTitle: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    drawerSectionSubtitle: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      fontWeight: '600',
    },
    themeOptions: {
      gap: theme.spacing.sm,
    },
    themeOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    themeOptionSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surface,
    },
    themeOptionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    themeOptionLabel: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      fontWeight: '600',
    },
    themeOptionDescription: {
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.textMuted,
    },
  });
