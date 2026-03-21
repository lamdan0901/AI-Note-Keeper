import React, { useEffect, useMemo, useRef } from 'react';
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
  activeScreen?: 'notes' | 'subscriptions' | 'trash';
  onNotesPress?: () => void;
  onTrashPress?: () => void;
  onSubscriptionsPress?: () => void;
  showSubscriptionsEntry?: boolean;
  showDueSubscriptionsIndicator?: boolean;
};

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  visible,
  onClose,
  drawerAnim,
  activeScreen,
  onNotesPress,
  onTrashPress,
  onSubscriptionsPress,
  showSubscriptionsEntry = true,
  showDueSubscriptionsIndicator = false,
}) => {
  const { theme, mode, setMode } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const bumpAnim = useRef(new Animated.Value(0)).current;

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
            <Text style={styles.drawerSectionTitle}>Screens</Text>
            <View style={styles.menuGroup}>
              <Pressable
                style={[
                  styles.drawerMenuItem,
                  activeScreen === 'notes' && styles.drawerMenuItemActive,
                ]}
                onPress={onNotesPress}
              >
                <View style={styles.drawerMenuLeft}>
                  <Ionicons
                    name={activeScreen === 'notes' ? 'document-text' : 'document-text-outline'}
                    size={20}
                    color={activeScreen === 'notes' ? theme.colors.primary : theme.colors.textMuted}
                  />
                  <View>
                    <Text
                      style={[
                        styles.drawerMenuLabel,
                        activeScreen === 'notes' && styles.drawerMenuLabelActive,
                      ]}
                    >
                      Notes
                    </Text>
                    <Text style={styles.drawerMenuDescription}>Capture and manage notes</Text>
                  </View>
                </View>
                {activeScreen === 'notes' ? (
                  <View style={styles.activeBadge} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                )}
              </Pressable>

              {showSubscriptionsEntry && (
                <Pressable
                  style={[
                    styles.drawerMenuItem,
                    activeScreen === 'subscriptions' && styles.drawerMenuItemActive,
                  ]}
                  onPress={onSubscriptionsPress}
                >
                  <View style={styles.drawerMenuLeft}>
                    <Ionicons
                      name={activeScreen === 'subscriptions' ? 'card' : 'card-outline'}
                      size={20}
                      color={
                        activeScreen === 'subscriptions'
                          ? theme.colors.primary
                          : theme.colors.textMuted
                      }
                    />
                    <View>
                      <Text
                        style={[
                          styles.drawerMenuLabel,
                          activeScreen === 'subscriptions' && styles.drawerMenuLabelActive,
                        ]}
                      >
                        Subscriptions
                      </Text>
                      <Text style={styles.drawerMenuDescription}>Track recurring payments</Text>
                    </View>
                  </View>
                  {activeScreen === 'subscriptions' ? (
                    <View style={styles.activeBadge} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                  )}
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
              )}

              <Pressable
                style={[
                  styles.drawerMenuItem,
                  activeScreen === 'trash' && styles.drawerMenuItemActive,
                ]}
                onPress={onTrashPress}
              >
                <View style={styles.drawerMenuLeft}>
                  <Ionicons
                    name={activeScreen === 'trash' ? 'trash' : 'trash-outline'}
                    size={20}
                    color={activeScreen === 'trash' ? theme.colors.primary : theme.colors.textMuted}
                  />
                  <View>
                    <Text
                      style={[
                        styles.drawerMenuLabel,
                        activeScreen === 'trash' && styles.drawerMenuLabelActive,
                      ]}
                    >
                      Trash
                    </Text>
                    <Text style={styles.drawerMenuDescription}>
                      Deleted notes and subscriptions
                    </Text>
                  </View>
                </View>
                {activeScreen === 'trash' ? (
                  <View style={styles.activeBadge} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerSectionTitle}>Settings</Text>
            <Text style={styles.drawerSectionSubtitle}>Theme</Text>
            <View style={styles.themeOptions}>
              {themeOptions.map((option) => {
                const isSelected = mode === option.key;
                return (
                  <Pressable
                    key={option.key}
                    style={[
                      styles.themeOptionButton,
                      isSelected && styles.themeOptionButtonSelected,
                    ]}
                    onPress={() => setMode(option.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} theme`}
                  >
                    <Ionicons
                      name={option.icon}
                      size={18}
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
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
    },
    menuGroup: {
      gap: theme.spacing.md,
    },
    themeOptions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    themeOptionButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    themeOptionButtonSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surface,
    },
    drawerDivider: {
      height: 1,
      backgroundColor: theme.colors.border,
      marginVertical: theme.spacing.sm,
    },
    drawerMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      position: 'relative',
    },
    drawerMenuItemActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surface,
    },
    drawerMenuLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flex: 1,
    },
    drawerMenuLabel: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      fontWeight: '500',
    },
    drawerMenuLabelActive: {
      color: theme.colors.primary,
      fontWeight: '600',
    },
    drawerMenuDescription: {
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.textMuted,
      marginTop: 1,
    },
    activeBadge: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.colors.primary,
    },
    dueDot: {
      position: 'absolute',
      right: 12,
      top: 8,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: theme.colors.cta,
    },
  });
