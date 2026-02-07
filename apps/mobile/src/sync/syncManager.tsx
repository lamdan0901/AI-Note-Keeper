import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import { getDb } from '../db/bootstrap';
import { syncNotes, SyncResult } from './noteSync';
import { getPendingCount } from './noteOutbox';

export type SyncState = {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;
  pendingCount: number;
  hasConflicts: boolean;
};

const defaultSyncState: SyncState = {
  isOnline: true,
  isSyncing: false,
  lastSyncAt: null,
  pendingCount: 0,
  hasConflicts: false,
};

const SyncContext = createContext<SyncState>(defaultSyncState);

export const useSyncState = () => useContext(SyncContext);

type SyncProviderProps = {
  children: React.ReactNode;
  userId?: string;
};

export const SyncProvider: React.FC<SyncProviderProps> = ({ children, userId = 'local-user' }) => {
  const [syncState, setSyncState] = useState<SyncState>(defaultSyncState);
  const syncInProgressRef = useRef(false);
  const pendingSyncRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Perform sync operation
  const performSync = useCallback(async () => {
    // Prevent concurrent syncs
    if (syncInProgressRef.current) {
      pendingSyncRef.current = true;
      return;
    }

    try {
      syncInProgressRef.current = true;
      setSyncState((prev) => ({ ...prev, isSyncing: true }));

      console.log('[SyncManager] Starting sync...');
      const db = await getDb();
      const result: SyncResult = await syncNotes(db, userId);

      // Get actual pending count from outbox after sync
      const pendingCount = await getPendingCount(db);

      setSyncState((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncAt: Date.now(),
        pendingCount,
        hasConflicts: result.conflictCount > 0,
      }));

      console.log('[SyncManager] Sync completed successfully', {
        pendingCount,
        hasConflicts: result.conflictCount > 0,
      });
    } catch (error) {
      console.error('[SyncManager] Sync failed:', error);

      // Still update pending count on failure
      try {
        const db = await getDb();
        const pendingCount = await getPendingCount(db);
        setSyncState((prev) => ({ ...prev, isSyncing: false, pendingCount }));
      } catch {
        setSyncState((prev) => ({ ...prev, isSyncing: false }));
      }
    } finally {
      syncInProgressRef.current = false;

      // If another sync was requested while we were syncing, perform it now
      if (pendingSyncRef.current) {
        pendingSyncRef.current = false;
        setTimeout(() => performSync(), 500);
      }
    }
  }, [userId]);

  // Debounced sync - prevents rapid-fire sync requests
  const debouncedSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSync();
      debounceTimerRef.current = null;
    }, 1000); // 1 second debounce
  }, [performSync]);

  // Handle network state changes
  const handleNetworkChange = useCallback(
    (state: NetInfoState) => {
      const isOnline = state.isConnected === true && state.isInternetReachable === true;
      const wasOnline = syncState.isOnline;

      console.log('[SyncManager] Network state changed:', {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        isOnline,
        wasOnline,
      });

      setSyncState((prev) => ({ ...prev, isOnline }));

      // If we just came online, trigger sync
      if (isOnline && !wasOnline) {
        console.log('[SyncManager] Coming online - triggering sync');
        debouncedSync();
      }
    },
    [syncState.isOnline, debouncedSync],
  );

  // Handle app state changes (foreground/background)
  const handleAppStateChange = useCallback(
    (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && syncState.isOnline) {
        console.log('[SyncManager] App became active - triggering sync');
        debouncedSync();
      }
    },
    [syncState.isOnline, debouncedSync],
  );

  // Setup network and app state listeners
  useEffect(() => {
    console.log('[SyncManager] Setting up listeners');

    // NetInfo listener
    const unsubscribeNetInfo = NetInfo.addEventListener(handleNetworkChange);

    // AppState listener
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial sync on mount
    performSync();

    return () => {
      console.log('[SyncManager] Cleaning up listeners');
      unsubscribeNetInfo();
      appStateSubscription.remove();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [handleNetworkChange, handleAppStateChange, performSync]);

  return <SyncContext.Provider value={syncState}>{children}</SyncContext.Provider>;
};
