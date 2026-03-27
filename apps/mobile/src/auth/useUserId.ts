import { useAuth } from './AuthContext';

export const useUserId = (): string => {
  const { userId } = useAuth();
  return userId;
};
