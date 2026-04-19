import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string URL'),
});

const authEnvSchema = z.object({
  JWT_ISSUER: z.string().min(1, 'JWT_ISSUER is required'),
  JWT_AUDIENCE: z.string().min(1, 'JWT_AUDIENCE is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  LEGACY_UPGRADE_SECRET: z.string().min(32, 'LEGACY_UPGRADE_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int('JWT_ACCESS_TTL_SECONDS must be an integer')
    .positive('JWT_ACCESS_TTL_SECONDS must be positive'),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int('JWT_REFRESH_TTL_SECONDS must be an integer')
    .positive('JWT_REFRESH_TTL_SECONDS must be positive'),
});

export type AuthConfig = z.infer<typeof authEnvSchema>;

const authDefaults: AuthConfig = {
  JWT_ISSUER: 'ai-note-keeper-dev',
  JWT_AUDIENCE: 'ai-note-keeper-clients',
  JWT_ACCESS_SECRET: 'dev-access-secret-that-is-at-least-32-chars',
  JWT_REFRESH_SECRET: 'dev-refresh-secret-that-is-at-least-32-chars',
  LEGACY_UPGRADE_SECRET: 'dev-legacy-upgrade-secret-at-least-32',
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 2_592_000,
};

const parseResult = envSchema.safeParse(process.env);

let cachedAuthConfig: AuthConfig | null = null;

if (!parseResult.success) {
  console.error('❌ Failed to parse environment variables:');
  console.error(parseResult.error.format());
  process.exit(1);
}

export const config = parseResult.data;

export const readAuthConfig = (env: NodeJS.ProcessEnv = process.env): AuthConfig => {
  if (env === process.env && cachedAuthConfig) {
    return cachedAuthConfig;
  }

  const strictMode = env.NODE_ENV === 'production';
  const source = strictMode ? env : { ...authDefaults, ...env };
  const parsed = authEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid auth configuration: ${JSON.stringify(parsed.error.format())}`);
  }

  if (env === process.env) {
    cachedAuthConfig = parsed.data;
  }

  return parsed.data;
};
