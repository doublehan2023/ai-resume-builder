import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONCURRENCY_LEASE_BUFFER_MS,
  AI_CONCURRENCY_LEASE_KEY,
  createAiConcurrencyLimiter,
} from "../services/aiConcurrency.js";
import { AI_POLICY } from "../configs/aiPolicy.js";

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

const createLeaseRedis = () => {
  const leases = new Map();

  return {
    leases,
    redis: {
      eval: async (script, keys, args) => {
        assert.deepEqual(keys, [AI_CONCURRENCY_LEASE_KEY]);

        if (script.includes("ZREMRANGEBYSCORE")) {
          const [nowMs, limit, expiresAt, token] = args;
          for (const [activeToken, activeExpiresAt] of leases) {
            if (activeExpiresAt <= Number(nowMs)) leases.delete(activeToken);
          }

          if (leases.size >= Number(limit)) return 0;
          leases.set(token, Number(expiresAt));
          return 1;
        }

        if (script.includes("ZREM")) {
          return Number(leases.delete(args[0]));
        }

        assert.fail("Unexpected Redis script");
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

test("rejects the eleventh active lease and admits another after release", async () => {
  const provider = createLeaseRedis();
  let tokenNumber = 0;
  const limiter = createAiConcurrencyLimiter({
    redis: provider.redis,
    limit: 10,
    createLeaseToken: () => `lease-${++tokenNumber}`,
  });

  const leases = await Promise.all(
    Array.from({ length: 10 }, () => limiter.acquire()),
  );
  assert.ok(leases.every(Boolean));
  assert.equal(await limiter.acquire(), null);

  await leases[0].release();
  assert.ok(await limiter.acquire());
});

test("reclaims expired leases before checking global capacity", async () => {
  const provider = createLeaseRedis();
  let currentTime = 1_000;
  let tokenNumber = 0;
  const limiter = createAiConcurrencyLimiter({
    redis: provider.redis,
    limit: 1,
    leaseTtlMs: 100,
    now: () => currentTime,
    createLeaseToken: () => `lease-${++tokenNumber}`,
  });

  assert.ok(await limiter.acquire());
  assert.equal(await limiter.acquire(), null);

  currentTime += 101;
  assert.ok(await limiter.acquire());
  assert.equal(provider.leases.size, 1);
});

test("releasing one token leaves other leases counted", async () => {
  const provider = createLeaseRedis();
  let tokenNumber = 0;
  const limiter = createAiConcurrencyLimiter({
    redis: provider.redis,
    limit: 2,
    createLeaseToken: () => `lease-${++tokenNumber}`,
  });

  const firstLease = await limiter.acquire();
  const secondLease = await limiter.acquire();
  await firstLease.release();

  assert.ok(await limiter.acquire());
  await firstLease.release();
  assert.equal(await limiter.acquire(), null);
  assert.equal(provider.leases.size, 2);
  await secondLease.release();
});

test("sets the default lease TTL beyond the configured AI timeout", async () => {
  const provider = createRedis([1]);
  const limiter = createAiConcurrencyLimiter({ redis: provider.redis });

  await limiter.acquire();

  assert.equal(
    provider.calls[0][2][4],
    String(AI_POLICY.global.timeoutMs + AI_CONCURRENCY_LEASE_BUFFER_MS),
  );
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
