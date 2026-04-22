import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getDb } from '../db/bootstrap';
import {
  AuthSession,
  clearAnonymousInstallKeys,
  clearAuthSession,
  getOrCreateDeviceId,
  hasCompletedInstallBootstrap,
  hasStoredDeviceId,
  loadLegacySessionUpgradePayload,
  loadAuthSession,
  markInstallBootstrapCompleted,
  saveAuthSession,
} from './session';
import { createMobileAuthHttpClient } from './httpClient';
import { clearAuthenticatedMobileUserData } from './logoutCleanup';
import { beginLogoutTransition, endLogoutTransition, isLogoutTransitionActive } from './logoutState';
import {
  backfillMissingLocalUserId as backfillUserIdInDb,
  clearAllLocalData as clearAllLocalDataInDb,
  clearLocalUserData as clearLocalUserDataInDb,
  inspectLocalDataFootprint,
  migrateLocalUserData as migrateLocalUserDataInDb,
} from './localUserData';
import { clearMobileWelcomeCompleted, hasCompletedMobileWelcome } from './localMode';
import { resolveLocalDataAction } from './authFlowPolicy';
import { MergeStrategy, MergeSummary } from '../../../../packages/shared/auth/userDataMerge';

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
  accessToken?: string;
  refreshToken?: string;
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
  const currentTokensRef = useRef<Readonly<{ accessToken: string; refreshToken?: string }> | null>(
    null,
  );
  const authHttpClient = useMemo(() => createMobileAuthHttpClient(), []);

  useEffect(() => {
    const init = async () => {
      try {
        await runFreshInstallResetIfNeeded();
        const deviceId = await getOrCreateDeviceId();
        const session = await loadAuthSession();

        if (session) {
          currentTokensRef.current =
            session.accessToken != null
              ? {
                  accessToken: session.accessToken,
                  refreshToken: session.refreshToken,
                }
              : null;

          if (authHttpClient && session.refreshToken && !isLogoutTransitionActive()) {
            try {
              const refreshed = await authHttpClient.refresh({
                refreshToken: session.refreshToken,
                deviceId,
              });

              if (isLogoutTransitionActive()) {
                return;
              }

              const latestSession = await loadAuthSession();
              if (
                !latestSession ||
                latestSession.userId !== session.userId ||
                latestSession.username !== session.username ||
                latestSession.accessToken !== session.accessToken ||
                latestSession.refreshToken !== session.refreshToken
              ) {
                return;
              }

              const refreshedSession: AuthSession = {
                userId: refreshed.userId,
                username: refreshed.username,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
              };

              await saveAuthSession(refreshedSession);
              currentTokensRef.current = {
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
              };
              await backfillMissingLocalUserId(refreshed.userId);
              setState({
                isLoading: false,
                isAuthenticated: true,
                userId: refreshed.userId,
                username: refreshed.username,
                deviceId,
                transitionState: 'idle',
                pendingMerge: null,
              });
              return;
            } catch {
              // Fall through to stored-session continuity when refresh is unavailable.
            }
          }

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

        if (authHttpClient) {
          const legacyUpgrade = await loadLegacySessionUpgradePayload();
          if (legacyUpgrade) {
            try {
              const upgraded = await authHttpClient.upgradeSession({
                userId: legacyUpgrade.userId,
                legacySessionToken: legacyUpgrade.legacySessionToken,
                deviceId,
              });

              const upgradedSession: AuthSession = {
                userId: upgraded.userId,
                username: upgraded.username,
                accessToken: upgraded.accessToken,
                refreshToken: upgraded.refreshToken,
              };

              await saveAuthSession(upgradedSession);
              currentTokensRef.current = {
                accessToken: upgraded.accessToken,
                refreshToken: upgraded.refreshToken,
              };
              await backfillMissingLocalUserId(upgraded.userId);
              setState({
                isLoading: false,
                isAuthenticated: true,
                userId: upgraded.userId,
                username: upgraded.username,
                deviceId,
                transitionState: 'idle',
                pendingMerge: null,
              });
              return;
            } catch {
              // Ignore failed legacy upgrade and continue with anonymous fallback.
            }
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
  }, [authHttpClient]);

  const finalizeAuthenticatedState = useCallback(
    async ({
      fromUserId,
      session,
      strategy,
      authHttpSucceededAt,
      flowLabel,
    }: {
      fromUserId: string;
      session: AuthSession;
      strategy?: MergeStrategy | 'cloud';
      authHttpSucceededAt?: number;
      flowLabel: 'login' | 'register' | 'merge';
    }) => {
      const localCleanupStartedAt = Date.now();
      await saveAuthSession(session);
      currentTokensRef.current =
        session.accessToken != null
          ? {
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
            }
          : null;
      if (currentSecretRef.current) {
        currentSecretRef.current = {
          username: session.username,
          password: currentSecretRef.current.password,
        };
      }

      const localDataAction = resolveLocalDataAction({ flowLabel, strategy });
      if (fromUserId && fromUserId !== session.userId) {
        if (localDataAction === 'clear') {
          await clearLocalUserData(fromUserId);
        } else if (localDataAction === 'migrate') {
          await migrateLocalUserData(fromUserId, session.userId);
        }
      }

      const localCleanupDurationMs = Date.now() - localCleanupStartedAt;
      await backfillMissingLocalUserId(session.userId);
      const stateCommittedAt = Date.now();
      setState((prev) => ({
        ...prev,
        isAuthenticated: true,
        userId: session.userId,
        username: session.username,
        transitionState: 'idle',
        pendingMerge: null,
      }));
      console.log('[Auth] Authenticated state committed', {
        flow: flowLabel,
        fromUserId,
        targetUserId: session.userId,
        localCleanupDurationMs,
        authHttpSuccessToStateCommitMs:
          authHttpSucceededAt == null ? null : stateCommittedAt - authHttpSucceededAt,
      });
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

        await finalizeAuthenticatedState({
          fromUserId: pendingMerge.fromUserId,
          session: {
            userId: pendingMerge.targetUserId,
            username: pendingMerge.accountUsername,
            accessToken: pendingMerge.accessToken,
            refreshToken: pendingMerge.refreshToken,
          },
          strategy,
          flowLabel: 'merge',
        });

        return { success: true };
      } catch (error) {
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        const message = error instanceof Error ? error.message : 'Merge failed';
        return { success: false, error: message };
      }
    },
    [finalizeAuthenticatedState],
  );

  const handleAuthSuccess = useCallback(
    async ({
      accountUserId,
      accountUsername,
      username,
      password,
      accessToken,
      refreshToken,
      authHttpSucceededAt,
      flowLabel,
    }: {
      accountUserId: string;
      accountUsername: string;
      username: string;
      password: string;
      accessToken?: string;
      refreshToken?: string;
      authHttpSucceededAt: number;
      flowLabel: 'login' | 'register';
    }): Promise<AuthResult> => {
      const fromUserId = state.userId;

      currentSecretRef.current = { username, password };
      currentTokensRef.current =
        accessToken != null
          ? {
              accessToken,
              refreshToken,
            }
          : null;

      await finalizeAuthenticatedState({
        fromUserId,
        session: {
          userId: accountUserId,
          username: accountUsername,
          accessToken,
          refreshToken,
        },
        strategy: flowLabel === 'register' ? 'local' : undefined,
        authHttpSucceededAt,
        flowLabel,
      });
      return { success: true };
    },
    [finalizeAuthenticatedState, state.userId],
  );

  const login = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      if (!authHttpClient) {
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        return { success: false, error: 'EXPO_PUBLIC_AUTH_API_URL is required for mobile auth' };
      }

      const startedAt = Date.now();
      try {
        const deviceId = await getOrCreateDeviceId();
        const result = await authHttpClient.login({ username, password, deviceId });
        const authHttpSucceededAt = Date.now();
        const authResult = await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          username,
          password,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          authHttpSucceededAt,
          flowLabel: 'login',
        });
        console.log('[Auth] Login finished', {
          userId: result.userId,
          totalDurationMs: Date.now() - startedAt,
        });
        return authResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Login failed';
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        return { success: false, error: message };
      }
    },
    [authHttpClient, handleAuthSuccess],
  );

  const register = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      if (!authHttpClient) {
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        return { success: false, error: 'EXPO_PUBLIC_AUTH_API_URL is required for mobile auth' };
      }

      const startedAt = Date.now();
      try {
        const deviceId = await getOrCreateDeviceId();
        const result = await authHttpClient.register({ username, password, deviceId });
        const authHttpSucceededAt = Date.now();
        const authResult = await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          username,
          password,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          authHttpSucceededAt,
          flowLabel: 'register',
        });
        console.log('[Auth] Registration finished', {
          userId: result.userId,
          totalDurationMs: Date.now() - startedAt,
        });
        return authResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Registration failed';
        setState((prev) => ({ ...prev, transitionState: 'idle' }));
        return { success: false, error: message };
      }
    },
    [authHttpClient, handleAuthSuccess],
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
    const startedAt = Date.now();
    const deviceId = await getOrCreateDeviceId();
    const previousUserId = state.userId;
    const refreshToken = currentTokensRef.current?.refreshToken;

    beginLogoutTransition();

    try {
      setState((prev) => ({ ...prev, transitionState: 'logout-snapshot' }));

      if (authHttpClient) {
        try {
          await authHttpClient.logout(refreshToken);
        } catch {
          // Keep local logout resilient when auth API is unavailable.
        }
      }

      await clearAuthenticatedMobileUserData(previousUserId, deviceId);

      await clearAuthSession();
      currentSecretRef.current = null;
      currentTokensRef.current = null;

      setState({
        isLoading: false,
        isAuthenticated: false,
        userId: deviceId,
        username: null,
        deviceId,
        transitionState: 'idle',
        pendingMerge: null,
      });
      console.log('[Auth] Logout finished', {
        previousUserId,
        deviceId,
        totalDurationMs: Date.now() - startedAt,
      });
    } finally {
      endLogoutTransition();
    }
  }, [authHttpClient, state.userId]);

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
