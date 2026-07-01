import { Receiver } from "@upstash/qstash";
import { NextRequest } from "next/server";

import type { QstashVerifierConfig } from "@backend/reminders/runtime";

import { getComposedServices } from "@/server/compose-services";

export type QstashVerifyInput = Readonly<{
  signature: string;
  body: string;
  url: string;
}>;

export type QstashVerify = (input: QstashVerifyInput) => Promise<boolean>;

export type RawBodyResult = Readonly<{
  rawBody: string;
  json: unknown;
}>;

/**
 * Read exact raw text then JSON.parse.
 * Use only for the QStash internal callback (never for normal /api routes).
 */
export async function readRawJsonBody(request: NextRequest): Promise<RawBodyResult> {
  const rawBody = await request.text();
  const json = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  return { rawBody, json };
}

/**
 * Build an injectable verify function from QStash config.
 * Mirrors Express `createVerifier` in internal-routes.ts.
 */
export const createQstashVerifier = (config: QstashVerifierConfig): QstashVerify => {
  const receiver = new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
  });

  return async (input: QstashVerifyInput) => {
    return await receiver.verify({
      signature: input.signature,
      body: input.body,
      url: input.url,
    });
  };
};

export type VerifyQstashSignatureInput = Readonly<{
  signature: string;
  body: string;
  config: QstashVerifierConfig;
  url?: string;
}>;

/**
 * Verify QStash signature against exact raw body and callback URL.
 * Pass a custom `verify` in tests to avoid calling the real Receiver.
 */
export async function verifyQstashSignature(
  input: VerifyQstashSignatureInput,
  verify?: QstashVerify,
): Promise<boolean> {
  const doVerify = verify ?? createQstashVerifier(input.config);
  return doVerify({
    signature: input.signature,
    body: input.body,
    url: input.url ?? input.config.callbackUrl,
  });
}

/** Read verifier config from composed services (undefined when scheduler disabled). */
export async function getQstashVerifierConfig(): Promise<QstashVerifierConfig | undefined> {
  const services = await getComposedServices();
  return services.reminderQstashVerifierConfig;
}