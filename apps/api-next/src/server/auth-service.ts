import { createAuthService, type AuthService } from "@backend/auth/service";

let authServiceOverride: AuthService | null = null;
let defaultAuthService: AuthService | null = null;

export const getAuthService = async (): Promise<AuthService> => {
  if (authServiceOverride !== null) {
    return authServiceOverride;
  }

  if (defaultAuthService === null) {
    defaultAuthService = createAuthService();
  }

  return defaultAuthService;
};

export const setAuthServiceForTests = (authService: AuthService): void => {
  authServiceOverride = authService;
};

export const resetAuthServiceForTests = (): void => {
  authServiceOverride = null;
};