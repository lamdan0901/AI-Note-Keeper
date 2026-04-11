import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBackendClient } from '../../../../packages/shared/backend/context';
import { getDb } from '../db/bootstrap';
import { syncNotes } from '../sync/noteSync';
import {
  AuthSession,
  clearAnonymousInstallKeys,
  clearAuthSession,
  getOrCreateDeviceId,
  hasCompletedInstallBootstrap,
  hasStoredDeviceId,
  loadAuthSession,
  markInstallBootstrapCompleted,
  saveAuthSession,
} from './session';
import {
  backfillMissingLocalUserId as backfillUserIdInDb,
  clearAllLocalData as clearAllLocalDataInDb,
  clearLocalUserData as clearLocalUserDataInDb,
  inspectLocalDataFootprint,
  migrateLocalUserData as migrateLocalUserDataInDb,
} from './localUserData';
import { clearMobileWelcomeCompleted, hasCompletedMobileWelcome } from './localMode';
import {
  MergeStrategy,
  MergeSummary,
  resolveMergeResolution,
} from '../../../../packages/shared/auth/userDataMerge';

type AuthTransitionState =
  | 'idle'
  | 'preflight'
  | 'awaiting-strategy'
  | 'applying'
  | 'logout-snapshot';

type PendingMerge = {
  summary: MergeSummary;
  fromUserId: string;
  targetUserId: string;
  username: string;
  password: string;
  accountUsername: string;
};

type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string;
  username: string | null;
  deviceId: string;
  transitionState: AuthTransitionState;
  pendingMerge: PendingMerge | null;
};

type AuthResult = {
  success: boolean;
  error?: string;
  requiresMerge?: boolean;
};

type AuthContextType = AuthState & {
  login: (username: string, password: string) => Promise<AuthResult>;
  register: (username: string, password: string) => Promise<AuthResult>;
  resolvePendingMerge: (strategy: MergeStrategy) => Promise<AuthResult>;
  cancelPendingMerge: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  isLoading: true,
  isAuthenticated: false,
  userId: '',
  username: null,
  deviceId: '',
  transitionState: 'idle',
  pendingMerge: null,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  resolvePendingMerge: async () => ({ success: false }),
  cancelPendingMerge: () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const migrateLocalUserData = async (fromUserId: string, toUserId: string): Promise<void> => {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return;
  const db = await getDb();
  const migrated = await migrateLocalUserDataInDb(db, fromUserId, toUserId);
  if (!migrated) {
    throw new Error('Local user migration failed');
  }
};

const clearLocalUserData = async (userId: string): Promise<void> => {
  if (!userId) return;
  const db = await getDb();
  const cleared = await clearLocalUserDataInDb(db, userId);
  if (!cleared) {
    throw new Error('Clearing local user data failed');
  }
};

const backfillMissingLocalUserId = async (userId: string): Promise<void> => {
  if (!userId) return;
  const db = await getDb();
  await backfillUserIdInDb(db, userId);
};

const syncNotesForUser = async (userId: string): Promise<void> => {
  const db = await getDb();
  await syncNotes(db, userId);
};

const clearAllLocalData = async (): Promise<void> => {
  const db = await getDb();
  const cleared = await clearAllLocalDataInDb(db);
  if (!cleared) {
    throw new Error('Clearing all local data failed');
  }
};

const hasExistingInstallFootprint = async (): Promise<boolean> => {
  const [hasSession, hasDeviceId, hasCompletedWelcome] = await Promise.all([
    loadAuthSession().then((session) => session !== null),
    hasStoredDeviceId(),
    hasCompletedMobileWelcome(),
  ]);

  if (hasSession || hasDeviceId || hasCompletedWelcome) {
    return true;
  }

  const db = await getDb();
  const footprint = await inspectLocalDataFootprint(db);
  if (!footprint.hasAnyData) {
    return false;
  }

  return footprint.hasNonLegacyData;
};

const runFreshInstallResetIfNeeded = async (): Promise<void> => {
  const hasBootstrapped = await hasCompletedInstallBootstrap();
  if (hasBootstrapped) {
    return;
  }

  const shouldPreserveExistingInstall = await hasExistingInstallFootprint();
  if (shouldPreserveExistingInstall) {
    await markInstallBootstrapCompleted();
    return;
  }

  await clearAllLocalData();
  await clearAuthSession();
  await clearAnonymousInstallKeys();
  await clearMobileWelcomeCompleted();
  await markInstallBootstrapCompleted();
};

type AuthProviderProps = {
  children: React.ReactNode;
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const backendClient = useBackendClient();
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    userId: '',
    username: null,
    deviceId: '',
    transitionState: 'idle',
    pendingMerge: null,
  });
  const currentSecretRef = useRef<{ username: string; password: string } | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await runFreshInstallResetIfNeeded();
        const deviceId = await getOrCreateDeviceId();
        const session = await loadAuthSession();

        if (session) {
          try {
            const user = await backendClient.validateSession(session.userId);
            if (user) {
              await backfillMissingLocalUserId(user.userId);
              setState({
                isLoading: false,
                isAuthenticated: true,
                userId: user.userId,
                username: user.username,
                deviceId,
                transitionState: 'idle',
                pendingMerge: null,
              });
              return;
            }
            await clearAuthSession();
          } catch {
            await backfillMissingLocalUserId(session.userId);
            setState({
              isLoading: false,
              isAuthenticated: true,
              userId: session.userId,
              username: session.username,
              deviceId,
              transitionState: 'idle',
              pendingMerge: null,
            });
            return;
          }
        }

        await backfillMissingLocalUserId(deviceId);
        setState({
          isLoading: false,
          isAuthenticated: false,
          userId: deviceId,
          username: null,
          deviceId,
          transitionState: 'idle',
          pendingMerge: null,
        });
      } catch {
        const fallbackDeviceId = await getOrCreateDeviceId();
        setState({
          isLoading: false,
          isAuthenticated: false,
          userId: fallbackDeviceId,
          username: null,
          deviceId: fallbackDeviceId,
          transitionState: 'idle',
          pendingMerge: null,
        });
      }
    };

    void init();
  }, [backendClient]);

  const finalizeAuthenticatedState = useCallback(
    async ({
      fromUserId,
      session,
      strategy,
    }: {
      fromUserId: string;
      session: AuthSession;
      strategy: MergeStrategy | 'cloud';
    }) => {
      await saveAuthSession(session);
      if (currentSecretRef.current) {
        currentSecretRef.current = {
          username: session.username,
          password: currentSecretRef.current.password,
        };
      }

      if (fromUserId && fromUserId !== session.userId) {
        if (strategy === 'cloud') {
          await clearLocalUserData(fromUserId);
        } else {
          await migrateLocalUserData(fromUserId, session.userId);
        }
      }

      await backfillMissingLocalUserId(session.userId);
      setState((prev) => ({
        ...prev,
        isAuthenticated: true,
        userId: session.userId,
        username: session.username,
        transitionState: 'idle',
        pendingMerge: null,
      }));
      await syncNotesForUser(session.userId);
    },
    [],
  );

  const applyResolvedMerge = useCallback(
    async (pendingMerge: PendingMerge, strategy: MergeStrategy): Promise<AuthResult> => {
      setState((prev) => ({ ...prev, transitionState: 'applying' }));

      try {
        currentSecretRef.current = {
          username: pendingMerge.username,
          password: pendingMerge.password,
        };

        if (strategy !== 'cloud') {
          await backendClient.applyUserDataMerge(
            pendingMerge.fromUserId,
            pendingMerge.targetUserId,
            pendingMerge.username,
            pendingMerge.password,
            strategy,
          );
        }

        await finalizeAuthenticatedState({
          fromUserId: pendingMerge.fromUserId,
          session: {
            userId: pendingMerge.targetUserId,
            username: pendingMerge.accountUsername,
          },
          strategy,
        });

        return { success: true };
      } catch (error) {
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        const message = error instanceof Error ? error.message : 'Merge failed';
        return { success: false, error: message };
      }
    },
    [backendClient, finalizeAuthenticatedState],
  );

  const handleAuthSuccess = useCallback(
    async ({
      accountUserId,
      accountUsername,
      username,
      password,
    }: {
      accountUserId: string;
      accountUsername: string;
      username: string;
      password: string;
    }): Promise<AuthResult> => {
      const fromUserId = state.userId;

      currentSecretRef.current = { username, password };

      if (fromUserId === accountUserId) {
        await finalizeAuthenticatedState({
          fromUserId,
          session: { userId: accountUserId, username: accountUsername },
          strategy: 'local',
        });
        return { success: true };
      }

      setState((prev) => ({ ...prev, transitionState: 'preflight' }));

      const summary = (await backendClient.preflightUserDataMerge(
        fromUserId,
        accountUserId,
        username,
        password,
      )) as MergeSummary;

      const resolution = resolveMergeResolution(summary);
      if (resolution === 'prompt') {
        setState((prev) => ({
          ...prev,
          transitionState: 'awaiting-strategy',
          pendingMerge: {
            summary,
            fromUserId,
            targetUserId: accountUserId,
            username,
            password,
            accountUsername,
          },
        }));
        return { success: false, requiresMerge: true };
      }

      return applyResolvedMerge(
        {
          summary,
          fromUserId,
          targetUserId: accountUserId,
          username,
          password,
          accountUsername,
        },
        resolution,
      );
    },
    [applyResolvedMerge, backendClient, finalizeAuthenticatedState, state.userId],
  );

  const login = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      try {
        const result = await backendClient.login(username, password);

        return await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          username,
          password,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Login failed';
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        return { success: false, error: message };
      }
    },
    [backendClient, handleAuthSuccess],
  );

  const register = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      try {
        const result = await backendClient.register(username, password);

        return await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          username,
          password,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Registration failed';
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        return { success: false, error: message };
      }
    },
    [backendClient, handleAuthSuccess],
  );

  const resolvePendingMerge = useCallback(
    async (strategy: MergeStrategy): Promise<AuthResult> => {
      if (!state.pendingMerge) {
        return { success: false, error: 'No pending merge' };
      }
      return applyResolvedMerge(state.pendingMerge, strategy);
    },
    [applyResolvedMerge, state.pendingMerge],
  );

  const cancelPendingMerge = useCallback(() => {
    setState((prev) => ({
      ...prev,
      transitionState: 'idle',
      pendingMerge: null,
    }));
  }, []);

  const logout = useCallback(async () => {
    const deviceId = await getOrCreateDeviceId();
    const previousUserId = state.userId;
    const previousUsername = state.username;
    const currentSecret = currentSecretRef.current;

    setState((prev) => ({ ...prev, transitionState: 'logout-snapshot' }));

    if (
      state.isAuthenticated &&
      previousUsername &&
      currentSecret?.password &&
      previousUserId !== deviceId
    ) {
      await backendClient.applyUserDataMerge(
        previousUserId,
        deviceId,
        currentSecret.username,
        currentSecret.password,
        'local',
      );
    }

    if (previousUserId && previousUserId !== deviceId) {
      await clearLocalUserData(deviceId);
      await migrateLocalUserData(previousUserId, deviceId);
    }

    await clearAuthSession();
    currentSecretRef.current = null;
    await backfillMissingLocalUserId(deviceId);

    setState({
      isLoading: false,
      isAuthenticated: false,
      userId: deviceId,
      username: null,
      deviceId,
      transitionState: 'idle',
      pendingMerge: null,
    });
  }, [backendClient, state.isAuthenticated, state.userId, state.username]);

  const value = useMemo(
    () => ({
      ...state,
      login,
      register,
      resolvePendingMerge,
      cancelPendingMerge,
      logout,
    }),
    [cancelPendingMerge, login, logout, register, resolvePendingMerge, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
