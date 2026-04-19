import assert from 'node:assert/strict';
import test from 'node:test';

import type { Request } from 'express';

import { requireAccessUser, type AuthenticatedRequest } from '../../auth/access-middleware.js';
import { createNoteChangeEventsRepository } from '../../notes/repositories/note-change-events-repository.js';
import { createNotesRepository } from '../../notes/repositories/notes-repository.js';

test('requireAccessUser rejects missing access token', async () => {
  const middleware = requireAccessUser({
    tokenFactory: {
      verifyAccessToken: async () => {
        throw new Error('should not run');
      },
    },
  });

  const request = {
    header: () => undefined,
  } as unknown as Request;

  const error = await new Promise<unknown>((resolve) => {
    middleware(request, {} as never, (nextError) => {
      resolve(nextError);
    });
  });

  assert.equal(typeof error, 'object');
  assert.equal((error as { code?: string }).code, 'auth');
  assert.equal((error as { message?: string }).message, 'Access token is required');
});

test('requireAccessUser injects authenticated user from access token', async () => {
  const middleware = requireAccessUser({
    tokenFactory: {
      verifyAccessToken: async (token) => {
        assert.equal(token, 'token-123');
        return {
          type: 'access',
          userId: 'user-1',
          username: 'alice',
          sessionId: 'session-1',
        };
      },
    },
  });

  const request = {
    header: (name: string) => {
      if (name.toLowerCase() === 'authorization') {
        return 'Bearer token-123';
      }

      return undefined;
    },
  } as unknown as Request;

  const error = await new Promise<unknown>((resolve) => {
    middleware(request, {} as never, (nextError) => {
      resolve(nextError);
    });
  });

  assert.equal(error, undefined);
  const authenticated = request as AuthenticatedRequest;
  assert.deepEqual(authenticated.authUser, {
    userId: 'user-1',
    username: 'alice',
  });
});

test('notes repository ownership predicates scope mutations by note id and user id', async () => {
  const queries: string[] = [];

  const repository = createNotesRepository({
    db: {
      query: async (text) => {
        queries.push(text);
        return { rows: [] };
      },
    },
  });

  await repository.findByIdForUser({ noteId: 'note-1', userId: 'user-1' });
  await repository.patch({
    noteId: 'note-1',
    userId: 'user-1',
    patch: {
      title: 'Updated',
    },
  });

  assert.match(queries[0], /where id = \$1 and user_id = \$2/i);
  assert.match(queries[1], /where id = \$2 and user_id = \$3/i);
});

test('note change events repository dedupe check scopes by note, user, operation, and payload hash', async () => {
  const capturedTexts: string[] = [];
  const capturedValues: Array<ReadonlyArray<unknown>> = [];

  const repository = createNoteChangeEventsRepository({
    db: {
      query: async (text, values) => {
        capturedTexts.push(text);
        capturedValues.push(values ?? []);
        return { rows: [] };
      },
    },
  });

  const isDuplicate = await repository.isDuplicate({
    noteId: 'note-1',
    userId: 'user-1',
    operation: 'update',
    payloadHash: 'hash-1',
  });

  assert.equal(isDuplicate, false);
  assert.equal(capturedTexts.length, 1);
  assert.match(capturedTexts[0], /where note_id = \$1/i);
  assert.match(capturedTexts[0], /and user_id = \$2/i);
  assert.match(capturedTexts[0], /and operation = \$3/i);
  assert.match(capturedTexts[0], /and payload_hash = \$4/i);
  assert.deepEqual(capturedValues[0], ['note-1', 'user-1', 'update', 'hash-1']);
});
