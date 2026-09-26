import assert from "node:assert/strict";
import test from "node:test";
import { AI_OPERATION } from "../configs/aiPolicy.js";
import {
  AI_EXECUTION_ERROR_CODE,
  AiConfigurationError,
  AiExecutionTimeoutError,
  AiRateLimitedError,
  AiRequestFailedError,
  AiUnavailableError,
  executeAiOperation as executeAiOperationWithLogging,
  getFullJitterDelayMs,
  getRetryAfterMs,
  isRetryableAiError,
  toAiExecutionError,
} from "../services/aiExecution.js";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const executeAiOperation = (request, dependencies = {}) =>
  executeAiOperationWithLogging(request, {
    logger: noopLogger,
    ...dependencies,
  });

const fakeClient = (response = { id: "completion-1" }) => {
  const requests = [];
  const options = [];
  return {
    requests,
    options,
    client: {
      chat: {
        completions: {
          create: async (request, requestOptions) => {
            requests.push(request);
            options.push(requestOptions);
            return response;
          },
        },
      },
    },
  };
};

test("succeeds on the first attempt with its server-owned model and output limit", async () => {
  const provider = fakeClient();
  const messages = [
    { role: "system", content: "Improve this resume summary." },
    { role: "user", content: "Software engineer" },
  ];

  const result = await executeAiOperation(
    {
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      messages,
    },
    {
      client: provider.client,
      getModel: () => "server-owned-model",
      now: () => 0,
    },
  );

  assert.deepEqual(result, { id: "completion-1" });
  assert.deepEqual(provider.requests, [{
    model: "server-owned-model",
    messages,
    max_tokens: 350,
  }]);
  assert.equal(provider.options[0].timeout, 25_000);
  assert.ok(provider.options[0].signal instanceof AbortSignal);
  assert.equal(provider.options[0].signal.aborted, false);
});

test("maps every AI operation to its configured output-token limit", async () => {
  const expectedLimits = new Map([
    [AI_OPERATION.PROFESSIONAL_SUMMARY, 350],
    [AI_OPERATION.JOB_DESCRIPTION, 500],
    [AI_OPERATION.RESUME_IMPORT, 2_000],
  ]);

  for (const [operation, maxTokens] of expectedLimits) {
    const provider = fakeClient();

    await executeAiOperation(
      {
        operation,
        messages: [{ role: "user", content: "Resume content" }],
      },
      {
        client: provider.client,
        getModel: () => "server-owned-model",
      },
    );

    assert.equal(provider.requests[0].max_tokens, maxTokens);
  }
});

test("passes a server-defined response format to resume import", async () => {
  const provider = fakeClient();
  const responseFormat = { type: "json_object" };

  await executeAiOperation(
    {
      operation: AI_OPERATION.RESUME_IMPORT,
      messages: [{ role: "user", content: "Resume text" }],
      responseFormat,
    },
    {
      client: provider.client,
      getModel: () => "server-owned-model",
    },
  );

  assert.deepEqual(provider.requests[0], {
    model: "server-owned-model",
    messages: [{ role: "user", content: "Resume text" }],
    max_tokens: 2_000,
    response_format: responseFormat,
  });
});

test("rejects an unsupported operation before calling the provider", async () => {
  const provider = fakeClient();

  await assert.rejects(
    executeAiOperation(
      {
        operation: "client-selected-operation",
        messages: [],
      },
      {
        client: provider.client,
        getModel: () => "server-owned-model",
      },
    ),
    (error) => {
      assert.ok(error instanceof AiConfigurationError);
      assert.equal(error.code, AI_EXECUTION_ERROR_CODE.CONFIGURATION);
      assert.equal(error.status, 500);
      assert.equal(error.message, "AI service is not configured.");
      assert.match(error.cause.message, /Unsupported AI operation/);
      return true;
    },
  );

  assert.equal(provider.requests.length, 0);
});

test("enforces one total timeout budget and aborts the provider request", async () => {
  let timeoutCallback;
  let scheduledDelay;
  let requestSignal;
  let clearedTimeout;
  const timeoutHandle = { id: "deadline" };
  const client = {
    chat: {
      completions: {
        create: async (_request, options) => {
          requestSignal = options.signal;
          return new Promise(() => {});
        },
      },
    },
  };

  const execution = executeAiOperation(
    {
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      messages: [{ role: "user", content: "Resume summary" }],
    },
    {
      client,
      getModel: () => "server-owned-model",
      timeoutMs: 25_000,
      setTimeout: (callback, delay) => {
        timeoutCallback = callback;
        scheduledDelay = delay;
        return timeoutHandle;
      },
      clearTimeout: (handle) => {
        clearedTimeout = handle;
      },
    },
  );

  // Allow the provider invocation queued by the execution service to run.
  await Promise.resolve();
  assert.equal(scheduledDelay, 25_000);
  assert.equal(requestSignal.aborted, false);

  timeoutCallback();

  await assert.rejects(execution, (error) => {
    assert.ok(error instanceof AiExecutionTimeoutError);
    assert.equal(error.code, "AI_TIMEOUT");
    assert.equal(error.status, 504);
    return true;
  });
  assert.equal(requestSignal.aborted, true);
  assert.equal(clearedTimeout, timeoutHandle);
});

test("clears the deadline after a successful provider response", async () => {
  const provider = fakeClient();
  let clearedTimeout;
  const timeoutHandle = { id: "deadline" };

  await executeAiOperation(
    {
      operation: AI_OPERATION.JOB_DESCRIPTION,
      messages: [{ role: "user", content: "Job description" }],
    },
    {
      client: provider.client,
      getModel: () => "server-owned-model",
      setTimeout: () => timeoutHandle,
      clearTimeout: (handle) => {
        clearedTimeout = handle;
      },
    },
  );

  assert.equal(clearedTimeout, timeoutHandle);
});

test("retries a transient provider failure and returns the later success", async () => {
  let attempts = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("temporarily unavailable"), {
              status: 503,
            });
          }
          return { id: "completion-after-retry" };
        },
      },
    },
  };

  const result = await executeAiOperation(
    {
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      messages: [{ role: "user", content: "Resume summary" }],
    },
    {
      client,
      getModel: () => "server-owned-model",
      sleep: async () => {},
    },
  );

  assert.deepEqual(result, { id: "completion-after-retry" });
  assert.equal(attempts, 2);
});

test("makes at most one initial call plus the configured retries", async () => {
  let attempts = 0;
  const providerError = Object.assign(new Error("provider overloaded"), {
    status: 503,
  });
  const client = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          throw providerError;
        },
      },
    },
  };

  await assert.rejects(
    executeAiOperation(
      {
        operation: AI_OPERATION.JOB_DESCRIPTION,
        messages: [{ role: "user", content: "Job description" }],
      },
      {
        client,
        getModel: () => "server-owned-model",
        maxRetries: 2,
        sleep: async () => {},
      },
    ),
    (error) => {
      assert.ok(error instanceof AiUnavailableError);
      assert.equal(error.code, AI_EXECUTION_ERROR_CODE.UNAVAILABLE);
      assert.equal(error.status, 503);
      assert.equal(error.cause, providerError);
      assert.doesNotMatch(error.message, /provider overloaded/);
      return true;
    },
  );

  assert.equal(attempts, 3);
});

test("does not retry non-transient HTTP failures", async (t) => {
  for (const status of [400, 401, 403, 404, 422]) {
    await t.test(`HTTP ${status}`, async () => {
      let attempts = 0;
      const providerError = Object.assign(new Error(`HTTP ${status}`), {
        status,
      });
      const client = {
        chat: {
          completions: {
            create: async () => {
              attempts += 1;
              throw providerError;
            },
          },
        },
      };

      await assert.rejects(
        executeAiOperation(
          {
            operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
            messages: [{ role: "user", content: "Resume summary" }],
          },
          {
            client,
            getModel: () => "server-owned-model",
            sleep: async () => {},
          },
        ),
        (error) => {
          assert.ok(error instanceof AiRequestFailedError);
          assert.equal(error.code, AI_EXECUTION_ERROR_CODE.REQUEST_FAILED);
          assert.equal(error.status, 502);
          assert.equal(error.cause, providerError);
          assert.doesNotMatch(error.message, new RegExp(`HTTP ${status}`));
          return true;
        },
      );

      assert.equal(attempts, 1);
    });
  }
});

test("classifies only selected HTTP and temporary connection failures as retryable", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableAiError({ status }), true, `HTTP ${status}`);
  }

  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableAiError({ status }), false, `HTTP ${status}`);
  }

  assert.equal(isRetryableAiError({ code: "ECONNRESET" }), true);
  assert.equal(
    isRetryableAiError({ status: 409, code: "resource_locked" }),
    true,
  );
  assert.equal(isRetryableAiError({ status: 409 }), false);
  assert.equal(
    isRetryableAiError({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
    true,
  );
  assert.equal(isRetryableAiError({ name: "APIConnectionError" }), true);
  assert.equal(isRetryableAiError({ name: "AbortError" }), false);
  assert.equal(isRetryableAiError(new Error("invalid model output")), false);
  assert.equal(isRetryableAiError(new AiExecutionTimeoutError(25_000)), false);
});

test("normalizes provider failures into stable safe execution errors", () => {
  const rateLimitCause = Object.assign(new Error("provider quota abc-123"), {
    status: 429,
  });
  const unavailableCause = Object.assign(new Error("upstream host details"), {
    status: 503,
  });
  const requestCause = Object.assign(new Error("invalid provider payload"), {
    status: 400,
  });

  const cases = [
    {
      error: toAiExecutionError(rateLimitCause),
      type: AiRateLimitedError,
      code: AI_EXECUTION_ERROR_CODE.RATE_LIMITED,
      status: 429,
      cause: rateLimitCause,
    },
    {
      error: toAiExecutionError(unavailableCause),
      type: AiUnavailableError,
      code: AI_EXECUTION_ERROR_CODE.UNAVAILABLE,
      status: 503,
      cause: unavailableCause,
    },
    {
      error: toAiExecutionError(requestCause),
      type: AiRequestFailedError,
      code: AI_EXECUTION_ERROR_CODE.REQUEST_FAILED,
      status: 502,
      cause: requestCause,
    },
  ];

  for (const value of cases) {
    assert.ok(value.error instanceof value.type);
    assert.equal(value.error.code, value.code);
    assert.equal(value.error.status, value.status);
    assert.equal(value.error.cause, value.cause);
    assert.doesNotMatch(value.error.message, /abc-123|host details|provider payload/);
  }
});

test("logs only safe operational metadata for a successful request", async () => {
  const entries = [];
  const messages = [
    { role: "system", content: "private system prompt" },
    { role: "user", content: "private resume text" },
  ];
  const provider = fakeClient({
    _request_id: "provider-request-123",
    choices: [{ message: { content: "private generated content" } }],
  });

  await executeAiOperation(
    { operation: AI_OPERATION.PROFESSIONAL_SUMMARY, messages },
    {
      client: provider.client,
      getModel: () => "server-owned-model",
      now: () => 1_000,
      logger: {
        info: (message, metadata) => entries.push({ level: "info", message, metadata }),
        warn: (message, metadata) => entries.push({ level: "warn", message, metadata }),
        error: (message, metadata) => entries.push({ level: "error", message, metadata }),
      },
    },
  );

  assert.deepEqual(entries, [{
    level: "info",
    message: "AI execution finished",
    metadata: {
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      attempt: 1,
      providerStatus: 200,
      elapsedMs: 0,
      requestId: "provider-request-123",
      outcome: "success",
    },
  }]);
  assert.doesNotMatch(
    JSON.stringify(entries),
    /private system prompt|private resume text|private generated content|server-owned-model/,
  );
});

test("logs retry and final failure metadata without provider error details", async () => {
  const entries = [];
  let attempts = 0;
  const providerError = Object.assign(
    new Error("provider host and credential details"),
    {
      status: 503,
      headers: { "x-request-id": "failed-request-456" },
    },
  );
  const client = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          throw providerError;
        },
      },
    },
  };
  const logger = {
    info: (message, metadata) => entries.push({ level: "info", message, metadata }),
    warn: (message, metadata) => entries.push({ level: "warn", message, metadata }),
    error: (message, metadata) => entries.push({ level: "error", message, metadata }),
  };

  await assert.rejects(
    executeAiOperation(
      {
        operation: AI_OPERATION.JOB_DESCRIPTION,
        messages: [{ role: "user", content: "private job description" }],
      },
      {
        client,
        getModel: () => "server-owned-model",
        maxRetries: 1,
        now: () => 2_000,
        sleep: async () => {},
        logger,
      },
    ),
    AiUnavailableError,
  );

  assert.equal(attempts, 2);
  assert.deepEqual(entries, [
    {
      level: "warn",
      message: "AI execution retry scheduled",
      metadata: {
        operation: AI_OPERATION.JOB_DESCRIPTION,
        attempt: 1,
        providerStatus: 503,
        elapsedMs: 0,
        requestId: "failed-request-456",
        outcome: "retrying",
      },
    },
    {
      level: "error",
      message: "AI execution finished",
      metadata: {
        operation: AI_OPERATION.JOB_DESCRIPTION,
        attempt: 2,
        providerStatus: 503,
        elapsedMs: 0,
        requestId: "failed-request-456",
        outcome: "unavailable",
      },
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(entries),
    /private job description|provider host|credential details|server-owned-model/,
  );
});

test("does not let logger failures change a successful AI result", async () => {
  const provider = fakeClient({ id: "completion-despite-log-failure" });

  const result = await executeAiOperation(
    {
      operation: AI_OPERATION.RESUME_IMPORT,
      messages: [{ role: "user", content: "Resume text" }],
    },
    {
      client: provider.client,
      getModel: () => "server-owned-model",
      logger: {
        info: () => {
          throw new Error("logger unavailable");
        },
      },
    },
  );

  assert.deepEqual(result, { id: "completion-despite-log-failure" });
});

test("wraps model configuration failures without exposing their details", async () => {
  const configurationCause = new Error("OPENAI_MODEL contains secret details");
  const provider = fakeClient();

  await assert.rejects(
    executeAiOperation(
      {
        operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
        messages: [{ role: "user", content: "Resume summary" }],
      },
      {
        client: provider.client,
        getModel: () => {
          throw configurationCause;
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof AiConfigurationError);
      assert.equal(error.code, AI_EXECUTION_ERROR_CODE.CONFIGURATION);
      assert.equal(error.status, 500);
      assert.equal(error.cause, configurationCause);
      assert.doesNotMatch(error.message, /secret details/);
      return true;
    },
  );

  assert.equal(provider.requests.length, 0);
});

test("uses deterministic exponential full-jitter backoff for each retry", () => {
  const policy = { baseDelayMs: 500, maxDelayMs: 15_000, random: () => 0.5 };

  assert.equal(getFullJitterDelayMs(0, policy), 250);
  assert.equal(getFullJitterDelayMs(1, policy), 500);
  assert.equal(getFullJitterDelayMs(2, policy), 1_000);
  assert.equal(getFullJitterDelayMs(10, policy), 7_500);
});

test("respects numeric and HTTP-date Retry-After headers", () => {
  const now = Date.parse("2026-09-25T12:00:00.000Z");

  assert.equal(getRetryAfterMs({ headers: { "retry-after": "3" } }, now), 3_000);
  assert.equal(
    getRetryAfterMs(
      { headers: new Headers({ "Retry-After": "Thu, 25 Sep 2026 12:00:05 GMT" }) },
      now,
    ),
    5_000,
  );
  assert.equal(getRetryAfterMs({ headers: { "retry-after": "invalid" } }, now), undefined);
});

test("injects sleep and random so retry backoff is deterministic", async () => {
  let attempts = 0;
  const delays = [];
  const client = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          if (attempts < 3) {
            throw Object.assign(new Error("provider overloaded"), { status: 503 });
          }
          return { id: "completion-after-backoff" };
        },
      },
    },
  };

  const result = await executeAiOperation(
    {
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      messages: [{ role: "user", content: "Resume summary" }],
    },
    {
      client,
      getModel: () => "server-owned-model",
      random: () => 0.5,
      sleep: async (delayMs) => delays.push(delayMs),
    },
  );

  assert.deepEqual(result, { id: "completion-after-backoff" });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("uses Retry-After instead of jitter when the provider supplies it", async () => {
  let attempts = 0;
  const delays = [];
  const client = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("rate limited"), {
              status: 429,
              headers: { "retry-after": "2" },
            });
          }
          return { id: "completion-after-retry-after" };
        },
      },
    },
  };

  const result = await executeAiOperation(
    {
      operation: AI_OPERATION.JOB_DESCRIPTION,
      messages: [{ role: "user", content: "Job description" }],
    },
    {
      client,
      getModel: () => "server-owned-model",
      random: () => assert.fail("jitter must not run when Retry-After is valid"),
      sleep: async (delayMs) => delays.push(delayMs),
    },
  );

  assert.deepEqual(result, { id: "completion-after-retry-after" });
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2_000]);
});

test("shares one decreasing timeout budget across retry attempts", async () => {
  let currentTime = 0;
  let attempts = 0;
  let scheduledDeadline;
  const attemptTimeouts = [];
  const client = {
    chat: {
      completions: {
        create: async (_request, options) => {
          attempts += 1;
          attemptTimeouts.push(options.timeout);

          if (attempts === 1) {
            currentTime = 3_000;
            throw Object.assign(new Error("temporarily unavailable"), {
              status: 503,
            });
          }

          return { id: "completion-within-original-deadline" };
        },
      },
    },
  };

  const result = await executeAiOperation(
    {
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      messages: [{ role: "user", content: "Resume summary" }],
    },
    {
      client,
      getModel: () => "server-owned-model",
      timeoutMs: 10_000,
      now: () => currentTime,
      random: () => 0,
      sleep: async () => {},
      setTimeout: (_callback, delay) => {
        scheduledDeadline = delay;
        return { id: "shared-deadline" };
      },
      clearTimeout: () => {},
    },
  );

  assert.deepEqual(result, { id: "completion-within-original-deadline" });
  assert.equal(attempts, 2);
  assert.equal(scheduledDeadline, 10_000);
  assert.deepEqual(attemptTimeouts, [10_000, 7_000]);
});

test("does not retry when the backoff cannot fit inside the timeout budget", async () => {
  let attempts = 0;
  let sleepCalled = false;
  const providerError = Object.assign(new Error("rate limited"), {
    status: 429,
    headers: { "retry-after": "2" },
  });
  const client = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          throw providerError;
        },
      },
    },
  };

  await assert.rejects(
    executeAiOperation(
      {
        operation: AI_OPERATION.RESUME_IMPORT,
        messages: [{ role: "user", content: "Resume text" }],
      },
      {
        client,
        getModel: () => "server-owned-model",
        timeoutMs: 1_000,
        now: () => 10_000,
        sleep: async () => {
          sleepCalled = true;
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof AiRateLimitedError);
      assert.equal(error.code, AI_EXECUTION_ERROR_CODE.RATE_LIMITED);
      assert.equal(error.status, 429);
      assert.equal(error.cause, providerError);
      return true;
    },
  );

  assert.equal(attempts, 1);
  assert.equal(sleepCalled, false);
});
