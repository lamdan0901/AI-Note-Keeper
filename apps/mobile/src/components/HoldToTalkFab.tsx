import React, { useMemo, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { type Theme, useTheme } from '../theme';
import { HOLD_DELAY_MS, createHoldInteraction } from './noteCardInteractions';
import { triggerVoiceHaptic } from '../utils/haptics';
import { isVoiceHoldEnabled } from '../voice/ui/voiceUiHelpers';

type AsyncCallback = () => void | Promise<void>;

export interface HoldToTalkFabProps {
  voiceCaptureEnabled: boolean;
  onManualPress: () => void;
  onHoldStart: AsyncCallback;
  onHoldCancel?: () => void;
  onInteractionError?: (error: unknown) => void;
  disabled?: boolean;
}

function runAsyncCallback(
  callback: AsyncCallback,
  onInteractionError?: (error: unknown) => void,
): void {
  try {
    const result = callback();
    if (result instanceof Promise) {
      void result.catch((error: unknown) => {
        onInteractionError?.(error);
      });
    }
  } catch (error) {
    onInteractionError?.(error);
  }
}

export function HoldToTalkFab({
  voiceCaptureEnabled,
  onManualPress,
  onHoldStart,
  onHoldCancel,
  onInteractionError,
  disabled = false,
}: HoldToTalkFabProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const holdEnabled = isVoiceHoldEnabled({
    platformOs: Platform.OS,
    voiceCaptureEnabled,
    disabled,
  });

  const suppressNextPressRef = useRef(false);
  const holdInteraction = useMemo(
    () =>
      createHoldInteraction({
        delayMs: HOLD_DELAY_MS,
        onHold: () => {
          triggerVoiceHaptic('listen-start');
          runAsyncCallback(onHoldStart, onInteractionError);
        },
      }),
    [onHoldStart, onInteractionError],
  );

  const handlePressIn = () => {
    if (!holdEnabled) {
      return;
    }
    holdInteraction.start();
  };

  const handlePressOut = () => {
    if (!holdEnabled) {
      return;
    }

    holdInteraction.end();

    if (holdInteraction.consumeHoldFired()) {
      suppressNextPressRef.current = true;
      return;
    }

    onHoldCancel?.();
  };

  const handlePress = () => {
    if (suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      return;
    }

    onManualPress();
  };

  return (
    <View style={styles.fabContainer}>
      <Pressable
        style={styles.fab}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={holdEnabled ? 'Create note with hold to talk' : 'Create note'}
        accessibilityHint={
          holdEnabled
            ? 'Tap to open editor, or press and hold to start voice capture'
            : 'Tap to open note editor'
        }
      >
        <Ionicons name="add" size={26} color="#ffffff" />
      </Pressable>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    fabContainer: {
      position: 'absolute',
      bottom: 100,
      right: theme.spacing.xl,
      zIndex: 900,
    },
    fab: {
      backgroundColor: theme.colors.primary,
      width: 46,
      height: 46,
      borderRadius: 23,
      justifyContent: 'center',
      alignItems: 'center',
      ...theme.shadows.md,
    },
  });
