import { hash, verify } from '@node-rs/argon2';
import { createHash } from 'node:crypto';

import type { PasswordVerificationResult } from './contracts.js';

const ARGON2_HASH_PREFIX = '$argon2id$';

const toLegacyHash = (password: string, salt: string): string => {
  return createHash('sha256').update(`${salt}${password}`).digest('hex');
};

const verifyLegacyHash = (password: string, storedHash: string): boolean => {
  const [salt, hashPart] = storedHash.split(':');

  if (!salt || !hashPart) {
    return false;
  }

  return toLegacyHash(password, salt) === hashPart;
};

const isArgon2Hash = (storedHash: string): boolean => {
  return storedHash.startsWith(ARGON2_HASH_PREFIX);
};

export const hashPasswordArgon2id = async (password: string): Promise<string> => {
  return await hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
};

export const verifyPassword = async (
  password: string,
  storedHash: string,
): Promise<PasswordVerificationResult> => {
  if (isArgon2Hash(storedHash)) {
    const verified = await verify(storedHash, password);
    return {
      verified,
      needsUpgrade: false,
      algorithm: 'argon2id',
    };
  }

  if (storedHash.includes(':')) {
    const verified = verifyLegacyHash(password, storedHash);
    return {
      verified,
      needsUpgrade: verified,
      algorithm: 'legacy-sha256',
    };
  }

  return {
    verified: false,
    needsUpgrade: false,
    algorithm: 'unknown',
  };
};
