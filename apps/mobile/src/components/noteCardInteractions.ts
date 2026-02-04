export const HOLD_DELAY_MS = 250;

type HoldInteractionConfig = {
  delayMs?: number;
  onHold: () => void;
};

export const createHoldInteraction = ({ delayMs = HOLD_DELAY_MS, onHold }: HoldInteractionConfig) => {
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdFired = false;

  const clearHoldTimer = () => {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
  };

  const start = () => {
    clearHoldTimer();
    holdFired = false;
    holdTimer = setTimeout(() => {
      holdFired = true;
      onHold();
    }, delayMs);
  };

  const end = () => {
    clearHoldTimer();
  };

  const consumeHoldFired = () => {
    if (!holdFired) return false;
    holdFired = false;
    return true;
  };

  return { start, end, consumeHoldFired };
};

type NoteCardTapDecisionParams = {
  selectionModeActive: boolean;
};

export const getTapDecision = ({ selectionModeActive }: NoteCardTapDecisionParams) => {
  return selectionModeActive ? ('toggleSelection' as const) : ('open' as const);
};

