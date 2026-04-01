export type VoiceOverlayStatus = 'listening' | 'processing' | 'error';

type VoiceHoldEnabledParams = {
  platformOs: string;
  voiceCaptureEnabled: boolean;
  disabled?: boolean;
};

export function isVoiceHoldEnabled({
  platformOs,
  voiceCaptureEnabled,
  disabled = false,
}: VoiceHoldEnabledParams): boolean {
  return platformOs === 'android' && voiceCaptureEnabled && !disabled;
}

export function buildVoiceOverlayAccessibilityLabel(
  status: VoiceOverlayStatus,
  processingMessage?: string,
): string {
  if (status === 'listening') {
    return 'Voice recording in progress';
  }

  if (status === 'processing') {
    if (processingMessage && processingMessage.trim()) {
      return processingMessage.trim();
    }
    return 'Processing voice note';
  }

  return 'Voice capture error';
}

export function buildClarificationTurnLabel(turn: number, maxTurns: number): string {
  const safeTurn = Math.max(1, turn);
  const safeMaxTurns = Math.max(1, maxTurns);
  return `Clarification ${safeTurn} of ${safeMaxTurns}`;
}

export function canSubmitClarificationAnswer(answer: string, isSubmitting: boolean): boolean {
  if (isSubmitting) {
    return false;
  }

  return answer.trim().length > 0;
}