import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_OPERATION,
  AI_POLICY,
  getAiGlobalConcurrencyLimit,
  getAiOperationPolicy,
  getAiTimeoutMs,
  getServerAiModel,
} from "../configs/aiPolicy.js";

test("defines a complete, positive policy for every AI operation", () => {
  for (const operation of Object.values(AI_OPERATION)) {
    const policy = getAiOperationPolicy(operation);

    assert.ok(policy.rateLimit.capacity > 0);
    assert.ok(policy.rateLimit.refillWindowMs > 0);
    assert.ok(policy.dailyQuota > 0);
    assert.ok(policy.maxInputChars > 0);
    assert.ok(policy.maxOutputTokens > 0);
  }
});

test("uses validated global concurrency and retry settings", () => {
  assert.equal(AI_POLICY.global.concurrencyLimit, 10);
  assert.equal(AI_POLICY.global.timeoutMs, 25_000);
  assert.deepEqual(AI_POLICY.global.retry, {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    strategy: "full-jitter",
  });
});

test("validates the configurable global concurrency limit", () => {
  assert.equal(getAiGlobalConcurrencyLimit({}), 10);
  assert.equal(getAiGlobalConcurrencyLimit({ AI_GLOBAL_CONCURRENCY: "1" }), 1);
  assert.equal(getAiGlobalConcurrencyLimit({ AI_GLOBAL_CONCURRENCY: "100" }), 100);

  for (const value of ["0", "101", "1.5", "invalid"]) {
    assert.throws(
      () => getAiGlobalConcurrencyLimit({ AI_GLOBAL_CONCURRENCY: value }),
      /AI_GLOBAL_CONCURRENCY must be an integer between 1 and 100/,
    );
  }
});

test("validates the configurable AI timeout", () => {
  assert.equal(getAiTimeoutMs({}), 25_000);
  assert.equal(getAiTimeoutMs({ AI_TIMEOUT_MS: "10000" }), 10_000);

  for (const value of ["0", "-1", "1.5", "invalid"]) {
    assert.throws(
      () => getAiTimeoutMs({ AI_TIMEOUT_MS: value }),
      /AI_TIMEOUT_MS must be a positive safe integer/,
    );
  }
});

test("rejects unsupported operations", () => {
  assert.throws(() => getAiOperationPolicy("custom-model"), {
    message: "Unsupported AI operation: custom-model",
  });
});

test("reads the model only from server configuration", () => {
  const originalModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = "server-owned-model";
  assert.equal(getServerAiModel(), "server-owned-model");

  if (originalModel === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = originalModel;
  }
});
