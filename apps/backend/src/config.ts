import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().trim().url('DATABASE_URL must be a valid connection string URL'),
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

const schedulerEnvSchema = z.object({
  REMINDER_SCHEDULER_PROVIDER: z.enum(['disabled', 'qstash']).default('disabled'),
  REMINDER_SCHEDULER_CALLBACK_BASE_URL: z.string().url().optional(),
  QSTASH_TOKEN: z.string().min(1).optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
  QSTASH_URL: z.string().url().optional(),
});

type CoreConfig = z.infer<typeof envSchema>;
export type AuthConfig = z.infer<typeof authEnvSchema>;
export type ReminderSchedulerConfig = z.infer<typeof schedulerEnvSchema>;

const authDefaults: AuthConfig = {
  JWT_ISSUER: 'ai-note-keeper-dev',
  JWT_AUDIENCE: 'ai-note-keeper-clients',
  JWT_ACCESS_SECRET: 'dev-access-secret-that-is-at-least-32-chars',
  JWT_REFRESH_SECRET: 'dev-refresh-secret-that-is-at-least-32-chars',
  LEGACY_UPGRADE_SECRET: 'dev-legacy-upgrade-secret-at-least-32',
  JWT_ACCESS_TTL_SECONDS: 3_600,
  JWT_REFRESH_TTL_SECONDS: 2_592_000,
};

let cachedAuthConfig: AuthConfig | null = null;
let cachedCoreConfig: CoreConfig | null = null;

const resolveCoreConfig = (): CoreConfig => {
  if (cachedCoreConfig) {
    return cachedCoreConfig;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Failed to parse environment variables:');
    console.error(parsed.error.format());
    process.exit(1);
  }

  cachedCoreConfig = parsed.data;
  return parsed.data;
};

export const config = {
  get PORT(): number {
    return resolveCoreConfig().PORT;
  },
  get DATABASE_URL(): string {
    return resolveCoreConfig().DATABASE_URL;
  },
} satisfies CoreConfig;

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

export const readReminderSchedulerConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ReminderSchedulerConfig => {
  const parsed = schedulerEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid reminder scheduler configuration: ${JSON.stringify(parsed.error.format())}`,
    );
  }

  if (parsed.data.REMINDER_SCHEDULER_PROVIDER === 'qstash') {
    if (!parsed.data.REMINDER_SCHEDULER_CALLBACK_BASE_URL) {
      throw new Error('REMINDER_SCHEDULER_CALLBACK_BASE_URL is required for qstash scheduler');
    }

    if (!parsed.data.QSTASH_TOKEN) {
      throw new Error('QSTASH_TOKEN is required for qstash scheduler');
    }

    if (!parsed.data.QSTASH_CURRENT_SIGNING_KEY) {
      throw new Error('QSTASH_CURRENT_SIGNING_KEY is required for qstash scheduler');
    }

    if (!parsed.data.QSTASH_NEXT_SIGNING_KEY) {
      throw new Error('QSTASH_NEXT_SIGNING_KEY is required for qstash scheduler');
    }
  }

  return parsed.data;
};
