import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MergeStrategy, MergeSummary } from '../../../../packages/shared/auth/userDataMerge';
import {
  clearWebAuthSession,
  getOrCreateWebLocalUserId,
  loadLegacyWebAuthUpgradeSession,
  loadWebAuthSession,
  saveWebAuthSession,
  WebAuthSession,
} from './session';
import { createWebAuthHttpClient, WebAuthHttpError } from './httpClient';

type TransitionState = 'idle' | 'preflight' | 'awaiting-strategy' | 'applying' | 'logout-snapshot';

type PendingMerge = {
  summary: MergeSummary;
  fromUserId: string;
  targetUserId: string;
  username: string;
  password: string;
  accountUsername: string;
  accessToken?: string;
};

type SessionTokens = Readonly<{
  accessToken: string | null;
  refreshToken: string | null;
}>;

type AuthResult = {
  success: boolean;
  error?: string;
  requiresMerge?: boolean;
};

type WebAuthContextValue = {
  userId: string;
  username: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  transitionState: TransitionState;
  pendingMerge: PendingMerge | null;
  login: (username: string, password: string) => Promise<AuthResult>;
  register: (username: string, password: string) => Promise<AuthResult>;
  resolvePendingMerge: (strategy: MergeStrategy) => Promise<AuthResult>;
  cancelPendingMerge: () => void;
  logout: () => Promise<void>;
};

const WebAuthContext = createContext<WebAuthContextValue | undefined>(undefined);

export const WebAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [localUserId] = useState(() => getOrCreateWebLocalUserId());
  const initialSession = useMemo(() => loadWebAuthSession(), []);
  const [session, setSession] = useState<WebAuthSession | null>(() => initialSession);
  const [isLoading, setIsLoading] = useState(() => initialSession === null);
  const [transitionState, setTransitionState] = useState<TransitionState>('idle');
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const currentTokensRef = useRef<SessionTokens>({
    accessToken: initialSession?.accessToken ?? null,
    refreshToken: initialSession?.refreshToken ?? null,
  });
  const webAuthClient = useMemo(() => createWebAuthHttpClient(), []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const existing = initialSession;
      if (existing) {
        if (!cancelled) {
          currentTokensRef.current = {
            accessToken: existing.accessToken ?? null,
            refreshToken: existing.refreshToken ?? null,
          };
          setSession(existing);
          setIsLoading(false);
        }
        return;
      }

      const legacyUpgrade = loadLegacyWebAuthUpgradeSession();
      if (!legacyUpgrade || !webAuthClient) {
        if (!cancelled) {
          setSession(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const upgraded = await webAuthClient.upgradeSession({
          userId: legacyUpgrade.userId,
          legacySessionToken: legacyUpgrade.legacySessionToken,
        });
        if (!cancelled) {
          const nextSession: WebAuthSession = {
            userId: upgraded.userId,
            username: upgraded.username,
            accessToken: upgraded.accessToken,
            refreshToken: upgraded.refreshToken,
          };
          currentTokensRef.current = {
            accessToken: upgraded.accessToken,
            refreshToken: upgraded.refreshToken ?? null,
          };
          saveWebAuthSession(nextSession);
          setSession(nextSession);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [initialSession, webAuthClient]);

  const finalizeSession = useCallback((nextSession: WebAuthSession) => {
    currentTokensRef.current = {
      accessToken: nextSession.accessToken ?? null,
      refreshToken: nextSession.refreshToken ?? null,
    };
    saveWebAuthSession(nextSession);
    setSession(nextSession);
    setTransitionState('idle');
    setPendingMerge(null);
  }, []);

  const applyResolvedMerge = useCallback(
    async (merge: PendingMerge, _strategy: MergeStrategy): Promise<AuthResult> => {
      try {
        setTransitionState('applying');

        finalizeSession({
          userId: merge.targetUserId,
          username: merge.accountUsername,
          accessToken: merge.accessToken ?? currentTokensRef.current.accessToken ?? undefined,
          refreshToken: currentTokensRef.current.refreshToken ?? undefined,
        });
        return { success: true };
      } catch (error) {
        setTransitionState('idle');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Merge failed',
        };
      }
    },
    [finalizeSession],
  );

  const handleAuthSuccess = useCallback(
    async ({
      accountUserId,
      accountUsername,
      accessToken,
      refreshToken,
    }: {
      accountUserId: string;
      accountUsername: string;
      accessToken?: string;
      refreshToken?: string;
    }): Promise<AuthResult> => {
      currentTokensRef.current = {
        accessToken: accessToken ?? null,
        refreshToken: refreshToken ?? null,
      };

      if (localUserId === accountUserId) {
        finalizeSession({
          userId: accountUserId,
          username: accountUsername,
          accessToken: accessToken ?? undefined,
          refreshToken: refreshToken ?? undefined,
        });
        return { success: true };
      }

      // Stage-A decommission: web auth now finalizes directly on Express-backed session.
      finalizeSession({
        userId: accountUserId,
        username: accountUsername,
        accessToken: accessToken ?? undefined,
        refreshToken: refreshToken ?? undefined,
      });
      return { success: true };
    },
    [finalizeSession, localUserId],
  );

  const login = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      if (!webAuthClient) {
        setTransitionState('idle');
        return {
          success: false,
          error: 'VITE_AUTH_API_BASE_URL is required for web auth API client',
        };
      }

      try {
        const result = await webAuthClient.login({ username, password });
        return await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
      } catch (error) {
        setTransitionState('idle');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Login failed',
        };
      }
    },
    [handleAuthSuccess, webAuthClient],
  );

  const getAccessToken = useCallback((): string | null => {
    return currentTokensRef.current.accessToken;
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (!webAuthClient) {
      currentTokensRef.current = {
        accessToken: null,
        refreshToken: null,
      };
      return null;
    }

    try {
      const refreshed = await webAuthClient.refresh({
        refreshToken: currentTokensRef.current.refreshToken ?? undefined,
      });
      const nextSession: WebAuthSession = {
        userId: refreshed.userId,
        username: refreshed.username,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      };
      currentTokensRef.current = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? null,
      };
      saveWebAuthSession(nextSession);
      setSession(nextSession);
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof WebAuthHttpError && error.status === 401) {
        clearWebAuthSession();
        currentTokensRef.current = {
          accessToken: null,
          refreshToken: null,
        };
        setSession(null);
      }

      return null;
    }
  }, [webAuthClient]);

  const register = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      if (!webAuthClient) {
        setTransitionState('idle');
        return {
          success: false,
          error: 'VITE_AUTH_API_BASE_URL is required for web auth API client',
        };
      }

      try {
        const result = await webAuthClient.register({
          username,
          password,
          guestUserId: localUserId,
        });
        return await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
      } catch (error) {
        setTransitionState('idle');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Registration failed',
        };
      }
    },
    [handleAuthSuccess, localUserId, webAuthClient],
  );

  const resolvePendingMerge = useCallback(
    async (strategy: MergeStrategy): Promise<AuthResult> => {
      if (!pendingMerge) {
        return { success: false, error: 'No pending merge' };
      }
      return applyResolvedMerge(pendingMerge, strategy);
    },
    [applyResolvedMerge, pendingMerge],
  );

  const cancelPendingMerge = useCallback(() => {
    setPendingMerge(null);
    setTransitionState('idle');
  }, []);

  const logout = useCallback(async () => {
    setTransitionState('logout-snapshot');

    if (webAuthClient) {
      try {
        await webAuthClient.logout(currentTokensRef.current.refreshToken ?? undefined);
      } catch {
        // Keep logout fail-safe for offline and partial backend outages.
      }
    }

    clearWebAuthSession();
    currentTokensRef.current = {
      accessToken: null,
      refreshToken: null,
    };
    setSession(null);
    setPendingMerge(null);
    setTransitionState('idle');
  }, [webAuthClient]);

  const value = useMemo<WebAuthContextValue>(
    () => ({
      userId: session?.userId ?? localUserId,
      username: session?.username ?? null,
      isAuthenticated: session !== null,
      isLoading,
      getAccessToken,
      refreshAccessToken,
      transitionState,
      pendingMerge,
      login,
      register,
      resolvePendingMerge,
      cancelPendingMerge,
      logout,
    }),
    [
      cancelPendingMerge,
      getAccessToken,
      isLoading,
      localUserId,
      login,
      logout,
      pendingMerge,
      refreshAccessToken,
      register,
      resolvePendingMerge,
      session,
      transitionState,
    ],
  );

  return <WebAuthContext.Provider value={value}>{children}</WebAuthContext.Provider>;
};

export const useWebAuth = (): WebAuthContextValue => {
  const value = useContext(WebAuthContext);
  if (!value) {
    throw new Error('useWebAuth must be used within WebAuthProvider');
  }
  return value;
};
