import AsyncStorage from '@react-native-async-storage/async-storage';

import { getDb } from '../db/bootstrap';
import { Note } from '../db/notesRepo';
import { saveNoteOffline } from '../notes/editor';
import {
  WELCOME_NOTE_CONTENT,
  WELCOME_NOTE_TITLE,
} from '../../../../packages/shared/constants/welcomeNote';

export const MOBILE_WELCOME_COMPLETED_KEY = 'MOBILE_WELCOME_COMPLETED';

export const hasCompletedMobileWelcome = async (): Promise<boolean> => {
  const value = await AsyncStorage.getItem(MOBILE_WELCOME_COMPLETED_KEY);
  return value === '1';
};

export const markMobileWelcomeCompleted = async (): Promise<void> => {
  await AsyncStorage.setItem(MOBILE_WELCOME_COMPLETED_KEY, '1');
};

export const clearMobileWelcomeCompleted = async (): Promise<void> => {
  await AsyncStorage.removeItem(MOBILE_WELCOME_COMPLETED_KEY);
};

export const seedWelcomeSampleNoteIfNeeded = async (userId: string): Promise<boolean> => {
  const db = await getDb();
  const rows = await db.getAllAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM notes WHERE userId = ? AND active = 1`,
    [userId],
  );
  const count = rows[0]?.count ?? 0;
  if (count > 0) {
    return false;
  }

  const now = Date.now();
  const note: Note = {
    id: `welcome-${userId}`,
    userId,
    title: WELCOME_NOTE_TITLE,
    content: WELCOME_NOTE_CONTENT,
    color: null,
    active: true,
    done: false,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
    serverVersion: 0,
    version: 0,
  };

  await saveNoteOffline(db, note, 'create', userId);
  return true;
};
