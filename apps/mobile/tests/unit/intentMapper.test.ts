import { describe, expect, it } from '@jest/globals';
import { mapVoiceIntentDraftToEditor } from '../../src/voice/intentDraftMapper';
import type { VoiceIntentResponseDto } from '../../src/voice/types';

function buildResponse(overrides?: Partial<VoiceIntentResponseDto>): VoiceIntentResponseDto {
  return {
    draft: {
      title: 'Buy groceries',
      content: 'Buy milk and eggs',
      reminderAtEpochMs: 1_900_000_000_000,
      repeat: {
        kind: 'weekly',
        interval: 1,
        weekdays: [1],
      },
      keepTranscriptInContent: false,
      normalizedTranscript: 'buy groceries remind me monday at nine',
    },
    confidence: {
      title: 0.92,
      content: 0.9,
      reminder: 0.95,
      repeat: 0.91,
    },
    clarification: {
      required: false,
      question: null,
      missingFields: [],
    },
    ...overrides,
  };
}

describe('mapVoiceIntentDraftToEditor', () => {
  it('maps title, content, reminder, and repeat to editor fields', () => {
    const nowEpochMs = 1_800_000_000_000;
    const response = buildResponse();

    const mapped = mapVoiceIntentDraftToEditor(response, { nowEpochMs });

    expect(mapped.editorDraft.title).toBe('Buy groceries');
    expect(mapped.editorDraft.content).toBe('Buy milk and eggs');
    expect(mapped.editorDraft.reminder?.getTime()).toBe(1_900_000_000_000);
    expect(mapped.editorDraft.repeat).toEqual({
      kind: 'weekly',
      interval: 1,
      weekdays: [1],
    });
    expect(mapped.editorDraft.keepTranscriptInContent).toBe(false);
    expect(mapped.warnings).toEqual([]);
  });

  it('retains transcript in content when confidence is low', () => {
    const response = buildResponse({
      draft: {
        title: 'Plan trip',
        content: 'Book flights',
        reminderAtEpochMs: null,
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'plan trip and book flights to tokyo',
      },
      confidence: {
        title: 0.8,
        content: 0.45,
        reminder: 0,
        repeat: 0,
      },
    });

    const mapped = mapVoiceIntentDraftToEditor(response, { nowEpochMs: 1_800_000_000_000 });

    expect(mapped.editorDraft.keepTranscriptInContent).toBe(true);
    expect(mapped.editorDraft.content).toContain('Book flights');
    expect(mapped.editorDraft.content).toContain('Transcript:');
    expect(mapped.editorDraft.content).toContain('plan trip and book flights to tokyo');
  });

  it('falls back when reminder is invalid and discards incompatible repeat', () => {
    const response = buildResponse({
      draft: {
        title: null,
        content: null,
        reminderAtEpochMs: 1_000,
        repeat: {
          kind: 'custom',
          interval: -1,
          frequency: 'days',
        },
        keepTranscriptInContent: false,
        normalizedTranscript: 'call mom',
      },
      confidence: {
        title: 0,
        content: 0,
        reminder: 0,
        repeat: 0,
      },
    });

    const mapped = mapVoiceIntentDraftToEditor(response, {
      nowEpochMs: 1_800_000_000_000,
    });

    expect(mapped.editorDraft.reminder).toBeNull();
    expect(mapped.editorDraft.repeat).toBeNull();
    expect(mapped.editorDraft.content).toBe('call mom');
    expect(mapped.warnings).toContain('Discarded non-future reminder from AI draft.');
    expect(mapped.warnings).toContain('Discarded invalid repeat rule from AI draft.');
  });
});
