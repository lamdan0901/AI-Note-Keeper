import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

import type { QstashVerifierConfig } from "@backend/reminders/runtime";

import {
  createQstashVerifier,
  getQstashVerifierConfig,
  readRawJsonBody,
  verifyQstashSignature,
  type QstashVerifyInput,
} from "../src/http/raw-body";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../src/server/compose-services";

const verifierConfig: QstashVerifierConfig = {
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
  callbackUrl: "https://api.example.test/internal/reminders/scheduled-task",
};

test("readRawJsonBody preserves exact raw bytes including significant whitespace", async () => {
  const rawBody = '{"reminderId":"r1","occurrenceAt":"2026-06-13T10:05:00.000Z","version":1,"deliveryKey":"k"} ';
  const request = new NextRequest("http://localhost:3001/internal/reminders/scheduled-task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });

  const result = await readRawJsonBody(request);

  assert.equal(result.rawBody, rawBody);
  assert.deepEqual(result.json, {
    reminderId: "r1",
    occurrenceAt: "2026-06-13T10:05:00.000Z",
    version: 1,
    deliveryKey: "k",
  });
});

test("readRawJsonBody returns empty object for empty body", async () => {
  const request = new NextRequest("http://localhost:3001/internal/reminders/scheduled-task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "",
  });

  const result = await readRawJsonBody(request);

  assert.equal(result.rawBody, "");
  assert.deepEqual(result.json, {});
});

test("readRawJsonBody throws on invalid JSON", async () => {
  const request = new NextRequest("http://localhost:3001/internal/reminders/scheduled-task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });

  await assert.rejects(() => readRawJsonBody(request), SyntaxError);
});

test("verifyQstashSignature passes exact body string and full callbackUrl to verify", async () => {
  const captured: QstashVerifyInput[] = [];
  const body = '{"reminderId":"r1","occurrenceAt":"2026-06-13T10:05:00.000Z","version":1,"deliveryKey":"k"} ';

  const verified = await verifyQstashSignature(
    {
      signature: "signed-jwt",
      body,
      config: verifierConfig,
    },
    async (input) => {
      captured.push(input);
      return true;
    },
  );

  assert.equal(verified, true);
  assert.deepEqual(captured, [
    {
      signature: "signed-jwt",
      body,
      url: "https://api.example.test/internal/reminders/scheduled-task",
    },
  ]);
});

test("verifyQstashSignature uses injectable verify and returns false on failure", async () => {
  const verified = await verifyQstashSignature(
    {
      signature: "bad-signature",
      body: "{}",
      config: verifierConfig,
    },
    async () => false,
  );

  assert.equal(verified, false);
});

test("createQstashVerifier returns an async verify function", () => {
  const verify = createQstashVerifier(verifierConfig);
  assert.equal(typeof verify, "function");
});

test("getQstashVerifierConfig reads from composed services", () => {
  resetComposedServicesForTests();
  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    reminderQstashVerifierConfig: verifierConfig,
  });

  try {
    assert.deepEqual(getQstashVerifierConfig(), verifierConfig);
  } finally {
    resetComposedServicesForTests();
  }
});