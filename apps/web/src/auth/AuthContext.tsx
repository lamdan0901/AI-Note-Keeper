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
import {
  MergeStrategy,
  MergeSummary,
  resolveMergeResolution,
} from '../../../../packages/shared/auth/userDataMerge';
import {
  clearWebAuthSession,
  getOrCreateWebLocalUserId,
  loadWebAuthSession,
  saveWebAuthSession,
  WebAuthSession,
} from './session';

type TransitionState = 'idle' | 'preflight' | 'awaiting-strategy' | 'applying' | 'logout-snapshot';

type PendingMerge = {
  summary: MergeSummary;
  fromUserId: string;
  targetUserId: string;
  username: string;
  password: string;
  accountUsername: string;
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

export const WebAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const backendClient = useBackendClient();
  const [localUserId] = useState(() => getOrCreateWebLocalUserId());
  const [session, setSession] = useState<WebAuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [transitionState, setTransitionState] = useState<TransitionState>('idle');
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const currentSecretRef = useRef<{ username: string; password: string } | null>(null);

  useEffect(() => {
    const existing = loadWebAuthSession();
    setSession(existing);
    setIsLoading(false);
  }, []);

  const finalizeSession = useCallback((nextSession: WebAuthSession) => {
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
          await backendClient.applyUserDataMerge(
            merge.fromUserId,
            merge.targetUserId,
            merge.username,
            merge.password,
            strategy,
          );
        }

        finalizeSession({
          userId: merge.targetUserId,
          username: merge.accountUsername,
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
    [backendClient, finalizeSession],
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
      currentSecretRef.current = { username, password };

      if (localUserId === accountUserId) {
        finalizeSession({ userId: accountUserId, username: accountUsername });
        return { success: true };
      }

      setTransitionState('preflight');
      const summary = (await backendClient.preflightUserDataMerge(
        localUserId,
        accountUserId,
        username,
        password,
      )) as MergeSummary;

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
        },
        resolution,
      );
    },
    [applyResolvedMerge, backendClient, finalizeSession, localUserId],
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
        setTransitionState('idle');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Login failed',
        };
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
        setTransitionState('idle');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Registration failed',
        };
      }
    },
    [backendClient, handleAuthSuccess],
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
    if (currentSession && currentSecret?.password) {
      await backendClient.applyUserDataMerge(
        currentSession.userId,
        localUserId,
        currentSecret.username,
        currentSecret.password,
        'local',
      );
    }

    clearWebAuthSession();
    setSession(null);
    setPendingMerge(null);
    setTransitionState('idle');
  }, [backendClient, localUserId, session]);

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
