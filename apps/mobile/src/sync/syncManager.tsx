import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import { getDb } from '../db/bootstrap';
import { isReminderDeviceOnline, syncReminderDeliveryOwnership } from '../reminders/scheduler';
import { syncNotes, SyncResult } from './noteSync';
import { getPendingCount } from './noteOutbox';
import { isLogoutTransitionActive } from '../auth/logoutState';

export type ActionResult = {
  status: 'pending' | 'success' | 'error';
  message?: string;
  timestamp: number;
};

export type SyncState = {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;
  pendingCount: number;
  hasConflicts: boolean;
  actionResult: ActionResult | null;
};

const defaultSyncState: SyncState = {
  isOnline: true,
  isSyncing: false,
  lastSyncAt: null,
  pendingCount: 0,
  hasConflicts: false,
  actionResult: null,
};

type SyncContextType = SyncState & {
  notifyActionPending: () => void;
  notifyActionSuccess: () => void;
  notifyActionError: (message: string) => void;
  clearActionResult: () => void;
};

const SyncContext = createContext<SyncContextType>({
  ...defaultSyncState,
  notifyActionPending: () => {},
  notifyActionSuccess: () => {},
  notifyActionError: () => {},
  clearActionResult: () => {},
});

export const useSyncState = () => useContext(SyncContext);

type SyncProviderProps = {
  children: React.ReactNode;
  userId: string;
};

export const SyncProvider: React.FC<SyncProviderProps> = ({ children, userId }) => {
  const [syncState, setSyncState] = useState<SyncState>(defaultSyncState);
  const syncInProgressRef = useRef(false);
  const pendingSyncRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const actionResultTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reminderOwnershipSyncRef = useRef<Promise<void>>(Promise.resolve());

  // Action Result Helpers
  const clearActionResult = useCallback(() => {
    if (actionResultTimerRef.current) {
      clearTimeout(actionResultTimerRef.current);
      actionResultTimerRef.current = null;
    }
    setSyncState((prev) => ({ ...prev, actionResult: null }));
  }, []);

  const notifyActionPending = useCallback(() => {
    clearActionResult();
    setSyncState((prev) => ({
      ...prev,
      actionResult: { status: 'pending', timestamp: Date.now() },
    }));
  }, [clearActionResult]);

  const notifyActionSuccess = useCallback(() => {
    clearActionResult();
    setSyncState((prev) => ({
      ...prev,
      actionResult: { status: 'success', timestamp: Date.now() },
    }));

    // Auto-dismiss success after 2 seconds
    actionResultTimerRef.current = setTimeout(() => {
      clearActionResult();
    }, 2000);
  }, [clearActionResult]);

  const notifyActionError = useCallback(
    (message: string) => {
      clearActionResult();
      setSyncState((prev) => ({
        ...prev,
        actionResult: { status: 'error', message, timestamp: Date.now() },
      }));
    },
    [clearActionResult],
  );

  // Perform sync operation
  const performSync = useCallback(async () => {
    if (isLogoutTransitionActive()) {
      pendingSyncRef.current = false;
      return;
    }

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

      if (result.success) {
        console.log('[SyncManager] Sync completed successfully', {
          pendingCount,
          hasConflicts: result.conflictCount > 0,
        });
      } else {
        console.warn('[SyncManager] Sync completed with warnings', {
          pendingCount,
          hasConflicts: result.conflictCount > 0,
          error: result.error,
        });
      }
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

      if (isLogoutTransitionActive()) {
        pendingSyncRef.current = false;
        setSyncState((prev) => ({ ...prev, isSyncing: false }));
      } else if (pendingSyncRef.current) {
        // If another sync was requested while we were syncing, perform it now
        pendingSyncRef.current = false;
        setTimeout(() => performSync(), 500);
      }
    }
  }, [userId]);

  // Debounced sync - prevents rapid-fire sync requests
  const debouncedSync = useCallback(() => {
    if (isLogoutTransitionActive()) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSync();
      debounceTimerRef.current = null;
    }, 1000); // 1 second debounce
  }, [performSync]);

  const queueReminderOwnershipSync = useCallback((isOnline: boolean, source: string) => {
    reminderOwnershipSyncRef.current = reminderOwnershipSyncRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const db = await getDb();
          const result = await syncReminderDeliveryOwnership(db, isOnline, source);
          console.log('[SyncManager] Reminder delivery ownership synced', result);
        } catch (error) {
          console.error('[SyncManager] Reminder delivery ownership sync failed:', error);
        }
      });
  }, []);

  // Handle network state changes
  const handleNetworkChange = useCallback(
    (state: NetInfoState) => {
      const isOnline = isReminderDeviceOnline(state);
      const wasOnline = syncState.isOnline;

      if (isOnline === wasOnline) {
        return;
      }

      console.log('[SyncManager] Network state changed:', {
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        isOnline,
        wasOnline,
      });

      setSyncState((prev) => ({ ...prev, isOnline }));

      // If we just came online, trigger sync.
      if (isOnline && !wasOnline) {
        console.log('[SyncManager] Coming online - triggering sync');
        if (isLogoutTransitionActive()) {
          return;
        }
        queueReminderOwnershipSync(true, 'network_online');
        debouncedSync();
      }

      if (!isOnline && wasOnline) {
        console.log('[SyncManager] Going offline');
        queueReminderOwnershipSync(false, 'network_offline');
      }
    },
    [syncState.isOnline, debouncedSync, queueReminderOwnershipSync],
  );

  // Handle app state changes (foreground/background)
  const handleAppStateChange = useCallback(
    (nextAppState: AppStateStatus) => {
      if (isLogoutTransitionActive()) {
        return;
      }

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
      if (actionResultTimerRef.current) {
        clearTimeout(actionResultTimerRef.current);
      }
    };
  }, [handleNetworkChange, handleAppStateChange, performSync]);

  const contextValue = {
    ...syncState,
    notifyActionPending,
    notifyActionSuccess,
    notifyActionError,
    clearActionResult,
  };

  return <SyncContext.Provider value={contextValue}>{children}</SyncContext.Provider>;
};
