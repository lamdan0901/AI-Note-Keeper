import assert from "node:assert/strict";
import { test } from "node:test";

test("api-next workspace test script is wired", () => {
  assert.equal(process.env.npm_package_name, "@ai-note-keeper/api-next");
});