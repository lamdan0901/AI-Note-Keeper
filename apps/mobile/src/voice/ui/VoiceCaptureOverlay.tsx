import React, { useEffect, useMemo, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type Theme, useTheme } from '../../theme';
import {
  buildVoiceOverlayAccessibilityLabel,
  type VoiceOverlayStatus,
} from './voiceUiHelpers';

export interface VoiceCaptureOverlayProps {
  visible: boolean;
  status: VoiceOverlayStatus;
  transcript: string;
  processingMessage?: string;
  errorMessage?: string;
  onCancel: () => void;
  onRetry: () => void;
}

function ShimmerRow({ active }: { active: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 950,
        useNativeDriver: true,
      }),
    );
    loop.start();

    return () => {
      loop.stop();
      progress.stopAnimation();
      progress.setValue(0);
    };
  }, [active, progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-180, 180],
  });

  return (
    <View style={styles.shimmerTrack}>
      <Animated.View style={[styles.shimmerGlow, { transform: [{ translateX }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  shimmerTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
    marginTop: 8,
  },
  shimmerGlow: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 120,
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});

export function VoiceCaptureOverlay({
  visible,
  status,
  transcript,
  processingMessage,
  errorMessage,
  onCancel,
  onRetry,
}: VoiceCaptureOverlayProps) {
  const { theme } = useTheme();
  const componentStyles = useMemo(() => createStyles(theme), [theme]);

  if (!visible) {
    return null;
  }

  const title =
    status === 'listening'
      ? 'Listening...'
      : status === 'processing'
        ? processingMessage?.trim() || 'Processing your note...'
        : 'Voice capture failed';

  const subtitle =
    status === 'error'
      ? errorMessage?.trim() || 'Please retry voice capture or continue manually.'
      : transcript.trim() || 'Speak naturally. Release to process.';

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={componentStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onCancel} />
        <View
          style={componentStyles.card}
          accessible
          accessibilityLabel={buildVoiceOverlayAccessibilityLabel(status, processingMessage)}
          accessibilityRole="summary"
          accessibilityLiveRegion="polite"
        >
          <View style={componentStyles.iconWrap}>
            {status === 'processing' ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons
                name={status === 'error' ? 'alert-circle-outline' : 'mic'}
                size={20}
                color="#ffffff"
              />
            )}
          </View>

          <Text style={componentStyles.title}>{title}</Text>
          <Text style={componentStyles.subtitle}>{subtitle}</Text>

          {status === 'processing' && (
            <View style={componentStyles.shimmerWrap}>
              <ShimmerRow active />
              <ShimmerRow active />
            </View>
          )}

          <View style={componentStyles.actions}>
            {status === 'error' ? (
              <>
                <Pressable style={[componentStyles.actionButton, componentStyles.secondary]} onPress={onCancel}>
                  <Text style={componentStyles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable style={[componentStyles.actionButton, componentStyles.primary]} onPress={onRetry}>
                  <Text style={componentStyles.primaryText}>Retry</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={[componentStyles.actionButton, componentStyles.secondary]} onPress={onCancel}>
                <Text style={componentStyles.secondaryText}>Cancel</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.lg,
    },
    card: {
      width: '100%',
      maxWidth: 460,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: '700',
      fontFamily: theme.typography.fontFamily,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
      fontFamily: theme.typography.fontFamily,
    },
    shimmerWrap: {
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    actionButton: {
      borderRadius: theme.borderRadius.md,
      minHeight: 42,
      paddingHorizontal: theme.spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
    },
    primary: {
      backgroundColor: theme.colors.primary,
    },
    secondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    primaryText: {
      color: '#ffffff',
      fontWeight: '700',
      fontFamily: theme.typography.fontFamily,
    },
    secondaryText: {
      color: theme.colors.text,
      fontWeight: '600',
      fontFamily: theme.typography.fontFamily,
    },
  });