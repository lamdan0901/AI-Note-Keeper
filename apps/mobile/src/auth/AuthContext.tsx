import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConvexHttpClient } from 'convex/browser';

import { api } from '../../../../convex/_generated/api';
import { getDb } from '../db/bootstrap';
import {
  AuthSession,
  clearAuthSession,
  getOrCreateDeviceId,
  LEGACY_MIGRATION_DONE_KEY,
  loadAuthSession,
  saveAuthSession,
} from './session';
import {
  backfillMissingLocalUserId as backfillUserIdInDb,
  migrateLocalUserData as migrateLocalUserDataInDb,
} from './localUserData';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authApi = (api.functions as any).auth;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const migrationApi = (api.functions as any).userDataMigration;

const DEFAULT_LEGACY_USER_ID = 'local-user';

type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string;
  username: string | null;
  deviceId: string;
};

type AuthContextType = AuthState & {
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  isLoading: true,
  isAuthenticated: false,
  userId: '',
  username: null,
  deviceId: '',
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const getConvexClient = (): ConvexHttpClient | null => {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url);
};

const migrateLocalUserData = async (fromUserId: string, toUserId: string): Promise<boolean> => {
  try {
    const db = await getDb();
    return await migrateLocalUserDataInDb(db, fromUserId, toUserId);
  } catch (error) {
    console.warn('[Auth] Local migration failed:', error);
    return false;
  }
};

const backfillMissingLocalUserId = async (userId: string): Promise<void> => {
  if (!userId) return;
  try {
    const db = await getDb();
    await backfillUserIdInDb(db, userId);
  } catch (error) {
    console.warn('[Auth] Backfill missing userId failed:', error);
  }
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
  });

  const runLegacyMigrationIfNeeded = useCallback(async () => {
    const envUserId = process.env.EXPO_PUBLIC_USER_ID;
    if (!envUserId || envUserId === DEFAULT_LEGACY_USER_ID) return;

    const done = await AsyncStorage.getItem(LEGACY_MIGRATION_DONE_KEY);
    if (done === '1') return;

    let backendSuccess = true;
    let backendSkippedByPolicy = false;
    const client = getConvexClient();
    if (client && migrationApi?.migrateUserData) {
      try {
        await client.mutation(migrationApi.migrateUserData, {
          fromUserId: DEFAULT_LEGACY_USER_ID,
          toUserId: envUserId,
        });
      } catch (error) {
        backendSuccess = false;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Migration target must be a valid account user')) {
          backendSkippedByPolicy = true;
        }
        console.warn('[Auth] Legacy backend migration failed:', error);
      }
    }

    const localSuccess = await migrateLocalUserData(DEFAULT_LEGACY_USER_ID, envUserId);
    if ((backendSuccess || backendSkippedByPolicy) && localSuccess) {
      await AsyncStorage.setItem(LEGACY_MIGRATION_DONE_KEY, '1');
    }
  }, []);

  // Rehydrate session on mount
  useEffect(() => {
    const init = async () => {
      const deviceId = await getOrCreateDeviceId();
      await runLegacyMigrationIfNeeded();
      const session = await loadAuthSession();

      if (session) {
        // Validate session with Convex
        const client = getConvexClient();
        if (!client || !authApi?.validateSession) {
          await backfillMissingLocalUserId(session.userId);
          setState({
            isLoading: false,
            isAuthenticated: true,
            userId: session.userId,
            username: session.username,
            deviceId,
          });
          return;
        }

        try {
          const user = await client.query(authApi.validateSession, { userId: session.userId });
          if (user) {
            await backfillMissingLocalUserId(user.userId);
            setState({
              isLoading: false,
              isAuthenticated: true,
              userId: user.userId,
              username: user.username,
              deviceId,
            });
            return;
          }
          await clearAuthSession();
        } catch (e) {
          console.warn('[Auth] Session validation failed, using cached session:', e);
          await backfillMissingLocalUserId(session.userId);
          setState({
            isLoading: false,
            isAuthenticated: true,
            userId: session.userId,
            username: session.username,
            deviceId,
          });
          return;
        }
      }

      // Anonymous mode: use device UUID as userId
      await backfillMissingLocalUserId(deviceId);
      setState({
        isLoading: false,
        isAuthenticated: false,
        userId: deviceId,
        username: null,
        deviceId,
      });
    };

    void init();
  }, [runLegacyMigrationIfNeeded]);

  const login = useCallback(
    async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
      const client = getConvexClient();
      if (!client || !authApi?.login) {
        return { success: false, error: 'No backend configured' };
      }

      try {
        const result = await client.mutation(authApi.login, {
          username,
          password,
        });

        const session: AuthSession = {
          userId: result.userId,
          username: result.username,
        };
        await saveAuthSession(session);

        // Migrate anonymous data to authenticated account
        const fromUserId = state.userId;
        if (fromUserId && fromUserId !== result.userId && migrationApi?.migrateUserData) {
          try {
            await client.mutation(migrationApi.migrateUserData, {
              fromUserId,
              toUserId: result.userId,
              username: result.username,
              password,
            });
            await migrateLocalUserData(fromUserId, result.userId);
          } catch (e) {
            console.warn('[Auth] Data migration after login failed:', e);
          }
        }

        await backfillMissingLocalUserId(result.userId);

        setState((prev) => ({
          ...prev,
          isAuthenticated: true,
          userId: result.userId,
          username: result.username,
        }));

        return { success: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Login failed';
        return { success: false, error: message };
      }
    },
    [state.userId],
  );

  const register = useCallback(
    async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
      const client = getConvexClient();
      if (!client || !authApi?.register) {
        return { success: false, error: 'No backend configured' };
      }

      try {
        const result = await client.mutation(authApi.register, {
          username,
          password,
        });

        const session: AuthSession = {
          userId: result.userId,
          username: result.username,
        };
        await saveAuthSession(session);

        // Migrate anonymous data to new account
        const fromUserId = state.userId;
        if (fromUserId && fromUserId !== result.userId && migrationApi?.migrateUserData) {
          try {
            await client.mutation(migrationApi.migrateUserData, {
              fromUserId,
              toUserId: result.userId,
              username: result.username,
              password,
            });
            await migrateLocalUserData(fromUserId, result.userId);
          } catch (e) {
            console.warn('[Auth] Data migration after register failed:', e);
          }
        }

        await backfillMissingLocalUserId(result.userId);

        setState((prev) => ({
          ...prev,
          isAuthenticated: true,
          userId: result.userId,
          username: result.username,
        }));

        return { success: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Registration failed';
        return { success: false, error: message };
      }
    },
    [state.userId],
  );

  const logout = useCallback(async () => {
    await clearAuthSession();
    const deviceId = await getOrCreateDeviceId();
    await backfillMissingLocalUserId(deviceId);
    setState({
      isLoading: false,
      isAuthenticated: false,
      userId: deviceId,
      username: null,
      deviceId,
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
