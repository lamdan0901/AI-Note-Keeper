import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { createHoldInteraction } from '../../apps/mobile/src/components/noteCardInteractions';

describe('createHoldInteraction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not fire hold at 240ms', () => {
    const onHold = jest.fn();
    const hold = createHoldInteraction({ delayMs: 250, onHold });

    hold.start();
    jest.advanceTimersByTime(240);
    hold.end();

    expect(onHold).toHaveBeenCalledTimes(0);
  });

  test('fires hold at 250ms', () => {
    const onHold = jest.fn();
    const hold = createHoldInteraction({ delayMs: 250, onHold });

    hold.start();
    jest.advanceTimersByTime(250);
    hold.end();

    expect(onHold).toHaveBeenCalledTimes(1);
  });

  test('fires hold at 300ms', () => {
    const onHold = jest.fn();
    const hold = createHoldInteraction({ delayMs: 250, onHold });

    hold.start();
    jest.advanceTimersByTime(300);
    hold.end();

    expect(onHold).toHaveBeenCalledTimes(1);
  });
});

describe('note-card selection toggle flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('long press selects, short tap unselects, next short tap stays unselected', () => {
    let isSelected = false;
    const openCount = { value: 0 };

    const onToggleSelected = () => {
      isSelected = !isSelected;
    };

    const onOpen = () => {
      openCount.value += 1;
    };

    const getSelectionModeActive = () => isSelected;

    const hold = createHoldInteraction({
      delayMs: 250,
      onHold: () => {
        if (isSelected) return;
        onToggleSelected();
      },
    });

    hold.start();
    jest.advanceTimersByTime(250);
    hold.end();

    expect(isSelected).toBe(true);

    const tapAfterHoldSuppressed = hold.consumeHoldFired();
    expect(tapAfterHoldSuppressed).toBe(true);

    if (!tapAfterHoldSuppressed) {
      if (getSelectionModeActive()) onToggleSelected();
      else onOpen();
    }

    expect(isSelected).toBe(true);
    expect(openCount.value).toBe(0);

    const tap1Suppressed = hold.consumeHoldFired();
    expect(tap1Suppressed).toBe(false);

    if (getSelectionModeActive()) onToggleSelected();
    else onOpen();

    expect(isSelected).toBe(false);
    expect(openCount.value).toBe(0);

    const tap2Suppressed = hold.consumeHoldFired();
    expect(tap2Suppressed).toBe(false);

    if (getSelectionModeActive()) onToggleSelected();
    else onOpen();

    expect(isSelected).toBe(false);
    expect(openCount.value).toBe(1);
  });
});

