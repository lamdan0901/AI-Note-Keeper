import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NotesList } from '../src/components/NotesList';
import type { WebNote } from '../src/services/notesTypes';

function makeNote(overrides: Partial<WebNote> = {}): WebNote {
  return {
    id: 'note-1',
    userId: 'local-user',
    title: 'Test note',
    content: 'Body',
    color: 'default',
    active: true,
    done: false,
    isPinned: false,
    updatedAt: 1_000,
    createdAt: 1_000,
    ...overrides,
  };
}

const noop = vi.fn();

describe('NotesList', () => {
  it('adds the pinned grid modifier only for pinned notes in grid view', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NotesList, {
        notes: [
          makeNote({ id: 'pinned-1', isPinned: true, updatedAt: 4_000 }),
          makeNote({ id: 'pinned-2', isPinned: true, updatedAt: 3_000 }),
          makeNote({ id: 'other-1', isPinned: false, updatedAt: 2_000 }),
        ],
        viewMode: 'grid',
        onCardClick: noop,
        onToggleDone: noop,
        onTogglePin: noop,
        onDelete: noop,
      }),
    );

    expect(markup).toContain('notes-list__group notes-list__group--grid notes-list__group--pinned-grid');
    expect(markup).toContain('notes-list__group notes-list__group--grid');
  });

  it('does not add the pinned grid modifier in list view', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NotesList, {
        notes: [makeNote({ id: 'pinned-1', isPinned: true, updatedAt: 4_000 })],
        viewMode: 'list',
        onCardClick: noop,
        onToggleDone: noop,
        onTogglePin: noop,
        onDelete: noop,
      }),
    );

    expect(markup).not.toContain('notes-list__group--pinned-grid');
    expect(markup).toContain('notes-list__group notes-list__group--list');
  });
});
