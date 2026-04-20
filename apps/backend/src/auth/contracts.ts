export type PasswordVerificationResult = Readonly<{
  verified: boolean;
  needsUpgrade: boolean;
  algorithm: 'argon2id' | 'legacy-sha256' | 'unknown';
}>;

export type AccessTokenPayload = Readonly<{
  type: 'access';
  userId: string;
  username: string;
  sessionId: string;
}>;

export type RefreshTokenPayload = Readonly<{
  type: 'refresh';
  userId: string;
  sessionId: string;
  tokenId: string;
}>;

export type TokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}>;

export type AuthenticatedUser = Readonly<{
  userId: string;
  username: string;
}>;

export type UserRecord = Readonly<{
  id: string;
  username: string;
  passwordHash: string;
}>;

export type RefreshTokenRecord = Readonly<{
  id: string;
  userId: string;
  tokenHash: string;
  deviceId: string | null;
  expiresAt: Date;
  revoked: boolean;
}>;

export type DbQueryResult<Row extends Record<string, unknown>> = Readonly<{
  rows: ReadonlyArray<Row>;
}>;

export type DbQueryClient = Readonly<{
  query: <Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<DbQueryResult<Row>>;
}>;
