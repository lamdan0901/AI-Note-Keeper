import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { type Theme, useTheme } from '../../theme';
import { HOLD_DELAY_MS, createHoldInteraction } from '../../components/noteCardInteractions';
import { triggerVoiceHaptic } from '../../utils/haptics';
import {
  buildClarificationTurnLabel,
  canSubmitClarificationAnswer,
} from './voiceUiHelpers';

type AsyncCallback = () => void | Promise<void>;

export interface VoiceClarificationSheetProps {
  visible: boolean;
  question: string;
  turn: number;
  maxTurns: number;
  unresolvedWarning?: boolean;
  isSubmitting?: boolean;
  onCancel: () => void;
  onSubmitText: (answer: string) => void | Promise<void>;
  onHoldVoiceStart: AsyncCallback;
  onHoldVoiceEnd: AsyncCallback;
  onInteractionError?: (error: unknown) => void;
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

function ShimmerStripe({ active }: { active: boolean }) {
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
        duration: 900,
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

export function VoiceClarificationSheet({
  visible,
  question,
  turn,
  maxTurns,
  unresolvedWarning = false,
  isSubmitting = false,
  onCancel,
  onSubmitText,
  onHoldVoiceStart,
  onHoldVoiceEnd,
  onInteractionError,
}: VoiceClarificationSheetProps) {
  const { theme } = useTheme();
  const componentStyles = useMemo(() => createStyles(theme), [theme]);
  const [answer, setAnswer] = useState('');
  const suppressNextPressRef = useRef(false);
  const lastPromptRef = useRef<string | null>(null);

  const holdInteraction = useMemo(
    () =>
      createHoldInteraction({
        delayMs: HOLD_DELAY_MS,
        onHold: () => {
          triggerVoiceHaptic('listen-start');
          runAsyncCallback(onHoldVoiceStart, onInteractionError);
        },
      }),
    [onHoldVoiceStart, onInteractionError],
  );

  useEffect(() => {
    if (!visible) {
      setAnswer('');
      return;
    }

    if (lastPromptRef.current !== question) {
      triggerVoiceHaptic('clarification-prompt');
      lastPromptRef.current = question;
    }
  }, [visible, question]);

  if (!visible) {
    return null;
  }

  const canSubmit = canSubmitClarificationAnswer(answer, isSubmitting);

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }

    runAsyncCallback(() => onSubmitText(answer.trim()), onInteractionError);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <View style={componentStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onCancel} />
        <View style={componentStyles.sheet}>
          <View style={componentStyles.sheetHandle} />

          <Text style={componentStyles.turnMeta}>{buildClarificationTurnLabel(turn, maxTurns)}</Text>
          <Text style={componentStyles.question}>{question}</Text>

          {unresolvedWarning && (
            <View style={componentStyles.warningBox}>
              <Ionicons name="warning-outline" size={18} color={theme.colors.error} />
              <Text style={componentStyles.warningText}>
                Some details are still ambiguous. You can answer now or review manually after this step.
              </Text>
            </View>
          )}

          <TextInput
            value={answer}
            onChangeText={setAnswer}
            placeholder="Type your answer"
            placeholderTextColor={theme.colors.textMuted}
            style={componentStyles.input}
            editable={!isSubmitting}
            multiline
            accessibilityLabel="Clarification response"
          />

          <View style={componentStyles.voiceRow}>
            <Pressable
              style={componentStyles.voiceButton}
              onPressIn={() => holdInteraction.start()}
              onPressOut={() => {
                holdInteraction.end();
                if (holdInteraction.consumeHoldFired()) {
                  suppressNextPressRef.current = true;
                  triggerVoiceHaptic('listen-stop');
                  runAsyncCallback(onHoldVoiceEnd, onInteractionError);
                }
              }}
              onPress={() => {
                if (suppressNextPressRef.current) {
                  suppressNextPressRef.current = false;
                }
              }}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Voice clarification response"
              accessibilityHint="Press and hold to speak your clarification answer"
            >
              <Ionicons name="mic" size={16} color="#ffffff" />
              <Text style={componentStyles.voiceButtonText}>Press and hold to answer by voice</Text>
            </Pressable>
          </View>

          {isSubmitting && (
            <View style={componentStyles.shimmerWrap}>
              <ShimmerStripe active />
              <ShimmerStripe active />
            </View>
          )}

          <View style={componentStyles.actions}>
            <Pressable
              style={[componentStyles.actionButton, componentStyles.secondary]}
              onPress={onCancel}
              disabled={isSubmitting}
            >
              <Text style={componentStyles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[componentStyles.actionButton, canSubmit ? componentStyles.primary : componentStyles.primaryDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              <Text style={componentStyles.primaryText}>Submit</Text>
            </Pressable>
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
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
      padding: theme.spacing.md,
    },
    sheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.borderRadius.xl,
      borderTopRightRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    sheetHandle: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.border,
      alignSelf: 'center',
      marginBottom: theme.spacing.xs,
    },
    turnMeta: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      fontWeight: '700',
      fontFamily: theme.typography.fontFamily,
    },
    question: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      lineHeight: 26,
      fontWeight: '700',
      fontFamily: theme.typography.fontFamily,
    },
    warningBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      borderWidth: 1,
      borderColor: theme.colors.error,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.background,
    },
    warningText: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
      fontFamily: theme.typography.fontFamily,
    },
    input: {
      minHeight: 88,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      color: theme.colors.text,
      fontSize: theme.typography.sizes.base,
      textAlignVertical: 'top',
      fontFamily: theme.typography.fontFamily,
    },
    voiceRow: {
      marginTop: theme.spacing.xs,
    },
    voiceButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
      borderRadius: theme.borderRadius.md,
      minHeight: 42,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: theme.spacing.md,
    },
    voiceButtonText: {
      color: '#ffffff',
      fontWeight: '700',
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
      marginBottom: theme.spacing.sm,
    },
    actionButton: {
      flex: 1,
      minHeight: 42,
      borderRadius: theme.borderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
    },
    primary: {
      backgroundColor: theme.colors.primary,
    },
    primaryDisabled: {
      backgroundColor: theme.colors.border,
    },
    secondary: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
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