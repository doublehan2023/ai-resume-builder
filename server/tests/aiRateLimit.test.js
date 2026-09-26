import assert from "node:assert/strict";
import test from "node:test";
import { AI_OPERATION } from "../configs/aiPolicy.js";
import {
  createAiRateLimitMiddleware,
  getAiRateLimitPrefix,
} from "../middlewares/aiRateLimit.js";

const response = () => {
  const result = {
    statusCode: undefined,
    body: undefined,
    headers: {},
  };

  result.set = (headers) => {
    Object.assign(result.headers, headers);
    return result;
  };
  result.status = (statusCode) => {
    result.statusCode = statusCode;
    return result;
  };
  result.json = (body) => {
    result.body = body;
    return result;
  };

  return result;
};

test("allows an authenticated request below the operation limit", async () => {
  let identifier;
  let nextCalled = false;
  const middleware = createAiRateLimitMiddleware(
    AI_OPERATION.PROFESSIONAL_SUMMARY,
    {
      limiter: {
        limit: async (value) => {
          identifier = value;
          return { success: true, limit: 10, remaining: 9, reset: Date.now() };
        },
      },
    },
  );

  await middleware({ userId: "user-123" }, response(), () => {
    nextCalled = true;
  });

  assert.equal(identifier, "user:user-123");
  assert.equal(nextCalled, true);
});

test("returns 429 and retry metadata when the operation limit is exhausted", async () => {
  const reset = Date.now() + 30_000;
  const middleware = createAiRateLimitMiddleware(
    AI_OPERATION.RESUME_IMPORT,
    {
      limiter: {
        limit: async () => ({
          success: false,
          limit: 3,
          remaining: 0,
          reset,
        }),
      },
    },
  );
  const res = response();

  await middleware({ userId: "user-123" }, res, () => {
    assert.fail("next must not be called for a rejected request");
  });

  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["X-RateLimit-Limit"], "3");
  assert.equal(res.headers["X-RateLimit-Remaining"], "0");
  assert.equal(res.headers["X-RateLimit-Reset"], String(reset));
  assert.match(res.headers["Retry-After"], /^\d+$/);
  assert.match(res.body.message, /Too many AI requests/);
});

test("rejects a request without an authenticated user before calling Redis", async () => {
  let limitCalled = false;
  const middleware = createAiRateLimitMiddleware(
    AI_OPERATION.JOB_DESCRIPTION,
    {
      limiter: {
        limit: async () => {
          limitCalled = true;
          return { success: true };
        },
      },
    },
  );
  const res = response();

  await middleware({}, res, () => {
    assert.fail("next must not be called for an unauthenticated request");
  });

  assert.equal(limitCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { message: "Unauthorized" });
});

test("fails closed and logs safe metadata when Redis is unavailable", async () => {
  const logged = [];
  const middleware = createAiRateLimitMiddleware(
    AI_OPERATION.PROFESSIONAL_SUMMARY,
    {
      limiter: {
        limit: async () => {
          throw new Error("connection refused");
        },
      },
      logger: {
        error: (...values) => logged.push(values),
      },
    },
  );
  const res = response();

  await middleware({ userId: "user-123", body: { userContent: "private resume" } }, res, () => {
    assert.fail("next must not be called while Redis is unavailable");
  });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { message: "AI service is temporarily unavailable." });
  assert.deepEqual(logged, [[
    "AI rate limiter unavailable",
    {
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      userId: "user-123",
      error: "connection refused",
    },
  ]]);
  assert.doesNotMatch(JSON.stringify(logged), /private resume/);
});

test("uses a separate Redis namespace for every AI operation", () => {
  const prefixes = Object.values(AI_OPERATION).map(getAiRateLimitPrefix);

  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.deepEqual(prefixes, [
    "ai-rate-limit:professionalSummary",
    "ai-rate-limit:jobDescription",
    "ai-rate-limit:resumeImport",
  ]);
});
