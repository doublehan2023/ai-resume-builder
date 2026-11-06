import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONCURRENCY_LEASE_KEY,
  createAiConcurrencyLimiter,
} from "../services/aiConcurrency.js";

const createRedis = (results = []) => {
  const calls = [];
  return {
    calls,
    redis: {
      eval: async (...args) => {
        calls.push(args);
        const next = results.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
};

test("acquires an atomic lease and releases only its own token once", async () => {
  const provider = createRedis([1, 1]);
  const limiter = createAiConcurrencyLimiter({
    redis: provider.redis,
    limit: 10,
    leaseTtlMs: 30_000,
    now: () => 1_000,
    createLeaseToken: () => "lease-1",
  });

  const lease = await limiter.acquire();
  assert.ok(lease);
  assert.equal(provider.calls.length, 1);
  const [acquireScript, acquireKeys, acquireArgs] = provider.calls[0];
  assert.match(acquireScript, /ZREMRANGEBYSCORE/);
  assert.match(acquireScript, /ZCARD/);
  assert.match(acquireScript, /ZADD/);
  assert.match(acquireScript, /PEXPIRE/);
  assert.deepEqual(acquireKeys, [AI_CONCURRENCY_LEASE_KEY]);
  assert.deepEqual(acquireArgs, ["1000", "10", "31000", "lease-1", "30000"]);

  await lease.release();
  await lease.release();
  assert.equal(provider.calls.length, 2);
  const [releaseScript, releaseKeys, releaseArgs] = provider.calls[1];
  assert.match(releaseScript, /ZREM/);
  assert.deepEqual(releaseKeys, [AI_CONCURRENCY_LEASE_KEY]);
  assert.deepEqual(releaseArgs, ["lease-1"]);
});

test("does not issue a lease when the global pool is full", async () => {
  const provider = createRedis([0]);
  const limiter = createAiConcurrencyLimiter({
    redis: provider.redis,
    createLeaseToken: () => "lease-full",
  });

  assert.equal(await limiter.acquire(), null);
  assert.equal(provider.calls.length, 1);
});

test("uses a different opaque token for each acquisition", async () => {
  const provider = createRedis([1, 1]);
  let tokenNumber = 0;
  const limiter = createAiConcurrencyLimiter({
    redis: provider.redis,
    createLeaseToken: () => `lease-${++tokenNumber}`,
  });

  await limiter.acquire();
  await limiter.acquire();

  assert.equal(provider.calls[0][2][3], "lease-1");
  assert.equal(provider.calls[1][2][3], "lease-2");
});

test("propagates Redis failures so execution can fail closed", async () => {
  const provider = createRedis([new Error("redis unavailable")]);
  const limiter = createAiConcurrencyLimiter({ redis: provider.redis });

  await assert.rejects(limiter.acquire(), /redis unavailable/);
});
