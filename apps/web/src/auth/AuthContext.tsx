import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ConvexHttpClient } from 'convex/browser';

import { api } from '../../../../convex/_generated/api';
import {
  MergeStrategy,
  MergeSummary,
  resolveMergeResolution,
} from '../../../../packages/shared/auth/userDataMerge';
import {
  clearWebAuthSession,
  getOrCreateWebLocalUserId,
  loadLegacyWebAuthUserId,
  loadWebAuthSession,
  saveWebAuthSession,
  WebAuthSession,
} from './session';
import { createWebAuthHttpClient } from './httpClient';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authApi = (api.functions as any).auth;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const migrationApi = (api.functions as any).userDataMigration;

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
  transitionState: TransitionState;
  pendingMerge: PendingMerge | null;
  login: (username: string, password: string) => Promise<AuthResult>;
  register: (username: string, password: string) => Promise<AuthResult>;
  resolvePendingMerge: (strategy: MergeStrategy) => Promise<AuthResult>;
  cancelPendingMerge: () => void;
  logout: () => Promise<void>;
};

const WebAuthContext = createContext<WebAuthContextValue | undefined>(undefined);

const getClient = (): ConvexHttpClient => {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) {
    throw new Error('VITE_CONVEX_URL is required');
  }
  return new ConvexHttpClient(url);
};

export const WebAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [localUserId] = useState(() => getOrCreateWebLocalUserId());
  const [session, setSession] = useState<WebAuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [transitionState, setTransitionState] = useState<TransitionState>('idle');
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const currentSecretRef = useRef<{ username: string; password: string } | null>(null);
  const currentAccessTokenRef = useRef<string | null>(null);
  const webAuthClient = useMemo(() => createWebAuthHttpClient(), []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const existing = loadWebAuthSession();
      if (existing) {
        if (!cancelled) {
          currentAccessTokenRef.current = existing.accessToken ?? null;
          setSession(existing);
          setIsLoading(false);
        }
        return;
      }

      const legacyUserId = loadLegacyWebAuthUserId();
      if (!legacyUserId || !webAuthClient) {
        if (!cancelled) {
          setSession(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const upgraded = await webAuthClient.upgradeSession({ userId: legacyUserId });
        if (!cancelled) {
          const nextSession: WebAuthSession = {
            userId: upgraded.userId,
            username: upgraded.username,
            accessToken: upgraded.accessToken,
          };
          currentAccessTokenRef.current = upgraded.accessToken;
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
  }, [webAuthClient]);

  const finalizeSession = useCallback((nextSession: WebAuthSession) => {
    currentAccessTokenRef.current = nextSession.accessToken ?? null;
    saveWebAuthSession(nextSession);
    setSession(nextSession);
    setTransitionState('idle');
    setPendingMerge(null);
  }, []);

  const applyResolvedMerge = useCallback(
    async (merge: PendingMerge, strategy: MergeStrategy): Promise<AuthResult> => {
      try {
        setTransitionState('applying');
        currentSecretRef.current = {
          username: merge.username,
          password: merge.password,
        };

        if (strategy !== 'cloud') {
          await getClient().mutation(migrationApi.applyUserDataMerge, {
            fromUserId: merge.fromUserId,
            toUserId: merge.targetUserId,
            username: merge.username,
            password: merge.password,
            strategy,
          });
        }

        finalizeSession({
          userId: merge.targetUserId,
          username: merge.accountUsername,
          accessToken: merge.accessToken ?? currentAccessTokenRef.current ?? undefined,
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
      username,
      password,
      accessToken,
    }: {
      accountUserId: string;
      accountUsername: string;
      username: string;
      password: string;
      accessToken?: string;
    }): Promise<AuthResult> => {
      currentSecretRef.current = { username, password };
      currentAccessTokenRef.current = accessToken ?? null;

      if (localUserId === accountUserId) {
        finalizeSession({
          userId: accountUserId,
          username: accountUsername,
          accessToken: accessToken ?? undefined,
        });
        return { success: true };
      }

      setTransitionState('preflight');
      const summary = (await getClient().mutation(migrationApi.preflightUserDataMerge, {
        fromUserId: localUserId,
        toUserId: accountUserId,
        username,
        password,
      })) as MergeSummary;

      const resolution = resolveMergeResolution(summary);
      if (resolution === 'prompt') {
        setTransitionState('awaiting-strategy');
        setPendingMerge({
          summary,
          fromUserId: localUserId,
          targetUserId: accountUserId,
          username,
          password,
          accountUsername,
          accessToken,
        });
        return { success: false, requiresMerge: true };
      }

      return applyResolvedMerge(
        {
          summary,
          fromUserId: localUserId,
          targetUserId: accountUserId,
          username,
          password,
          accountUsername,
          accessToken,
        },
        resolution,
      );
    },
    [applyResolvedMerge, finalizeSession, localUserId],
  );

  const login = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      if (webAuthClient) {
        try {
          const result = await webAuthClient.login({ username, password });
          return await handleAuthSuccess({
            accountUserId: result.userId,
            accountUsername: result.username,
            username,
            password,
            accessToken: result.accessToken,
          });
        } catch (error) {
          setTransitionState('idle');
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Login failed',
          };
        }
      }

      try {
        const result = await getClient().mutation(authApi.login, { username, password });
        return await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          username,
          password,
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

  const register = useCallback(
    async (username: string, password: string): Promise<AuthResult> => {
      if (webAuthClient) {
        try {
          const result = await webAuthClient.register({ username, password });
          return await handleAuthSuccess({
            accountUserId: result.userId,
            accountUsername: result.username,
            username,
            password,
            accessToken: result.accessToken,
          });
        } catch (error) {
          setTransitionState('idle');
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Registration failed',
          };
        }
      }

      try {
        const result = await getClient().mutation(authApi.register, { username, password });
        return await handleAuthSuccess({
          accountUserId: result.userId,
          accountUsername: result.username,
          username,
          password,
        });
      } catch (error) {
        setTransitionState('idle');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Registration failed',
        };
      }
    },
    [handleAuthSuccess, webAuthClient],
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
    const currentSession = session;
    const currentSecret = currentSecretRef.current;

    if (webAuthClient) {
      try {
        await webAuthClient.logout();
      } catch {
        // Keep logout fail-safe for offline and partial backend outages.
      }
    }

    if (currentSession && currentSecret?.password) {
      await getClient().mutation(migrationApi.applyUserDataMerge, {
        fromUserId: currentSession.userId,
        toUserId: localUserId,
        username: currentSecret.username,
        password: currentSecret.password,
        strategy: 'local',
      });
    }

    clearWebAuthSession();
    currentAccessTokenRef.current = null;
    setSession(null);
    setPendingMerge(null);
    setTransitionState('idle');
  }, [localUserId, session, webAuthClient]);

  const value = useMemo<WebAuthContextValue>(
    () => ({
      userId: session?.userId ?? localUserId,
      username: session?.username ?? null,
      isAuthenticated: session !== null,
      isLoading,
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
      isLoading,
      localUserId,
      login,
      logout,
      pendingMerge,
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
