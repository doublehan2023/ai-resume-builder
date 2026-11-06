import { randomUUID } from "node:crypto";
import getRedis from "../configs/redis.js";
import { AI_POLICY } from "../configs/aiPolicy.js";

export const AI_CONCURRENCY_LEASE_KEY = "ai-concurrency:leases";
export const AI_CONCURRENCY_LEASE_BUFFER_MS = 5_000;

const acquireLeaseScript = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call("ZADD", KEYS[1], ARGV[3], ARGV[4])
redis.call("PEXPIRE", KEYS[1], ARGV[5])
return 1
`;

const releaseLeaseScript = `
return redis.call("ZREM", KEYS[1], ARGV[1])
`;

export const createAiConcurrencyLimiter = ({
  redis = getRedis(),
  limit = AI_POLICY.global.concurrencyLimit,
  leaseTtlMs = AI_POLICY.global.timeoutMs + AI_CONCURRENCY_LEASE_BUFFER_MS,
  now = Date.now,
  createLeaseToken = randomUUID,
} = {}) => {
  const acquire = async () => {
    const acquiredAt = now();
    const token = createLeaseToken();
    const expiresAt = acquiredAt + leaseTtlMs;
    const acquired = await redis.eval(acquireLeaseScript, [AI_CONCURRENCY_LEASE_KEY], [
      String(acquiredAt),
      String(limit),
      String(expiresAt),
      token,
      String(leaseTtlMs),
    ]);

    if (Number(acquired) !== 1) return null;

    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await redis.eval(releaseLeaseScript, [AI_CONCURRENCY_LEASE_KEY], [token]);
      },
    };
  };

  return { acquire };
};

let limiter;

export const getAiConcurrencyLimiter = () => {
  if (!limiter) limiter = createAiConcurrencyLimiter();
  return limiter;
};
