import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme, useTheme } from '../theme';

type TabKey = 'notes' | 'subscriptions' | 'trash' | 'settings';

type Tab = {
  key: TabKey;
  label: string;
  icon: string;
  iconActive: string;
};

const ALL_TABS: Tab[] = [
  { key: 'notes', label: 'Notes', icon: 'document-text-outline', iconActive: 'document-text' },
  { key: 'subscriptions', label: 'Subscriptions', icon: 'card-outline', iconActive: 'card' },
  { key: 'trash', label: 'Trash', icon: 'trash-outline', iconActive: 'trash' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
];

type BottomTabBarProps = {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
  hasConvexClient: boolean;
  showDueSubscriptionsIndicator?: boolean;
};

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onTabPress,
  hasConvexClient,
  showDueSubscriptionsIndicator = false,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const bumpAnim = useRef(new Animated.Value(0)).current;

  const tabs = hasConvexClient ? ALL_TABS : ALL_TABS.filter((t) => t.key !== 'subscriptions');

  useEffect(() => {
    if (!showDueSubscriptionsIndicator) {
      bumpAnim.stopAnimation();
      bumpAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bumpAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.timing(bumpAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bumpAnim, showDueSubscriptionsIndicator]);

  return (
    <View style={styles.outerContainer} pointerEvents="box-none">
      <View style={styles.pillClip}>
        <View style={styles.pillContent}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={styles.tab}
                onPress={() => onTabPress(tab.key)}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.tabIconContainer}>
                  <Ionicons
                    name={(isActive ? tab.iconActive : tab.icon) as any}
                    size={26}
                    color={isActive ? theme.colors.primary : theme.colors.text}
                  />
                  {tab.key === 'subscriptions' && showDueSubscriptionsIndicator && (
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
                </View>
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    outerContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingBottom: 16,
    },
    pillClip: {
      width: '100%',
      borderRadius: 32,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
    },
    pillContent: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 8,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      gap: 3,
    },
    tabIconContainer: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabLabel: {
      fontSize: 11,
      color: theme.colors.text,
      fontFamily: theme.typography.fontFamily,
      fontWeight: '500',
    },
    tabLabelActive: {
      color: theme.colors.primary,
      fontWeight: '700',
    },
    dueDot: {
      position: 'absolute',
      right: -4,
      top: -2,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.cta,
    },
  });
