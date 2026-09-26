import { Ratelimit } from "@upstash/ratelimit";
import getRedis from "../configs/redis.js";
import { getAiOperationPolicy } from "../configs/aiPolicy.js";

const cache = new Map();

export const getAiRateLimitPrefix = (operation) =>
  `ai-rate-limit:${operation}`;

function createAiRateLimiter(operation) {
  if (cache.has(operation)) return cache.get(operation);
  const policy = getAiOperationPolicy(operation);
  const { capacity, refillWindowMs } = policy.rateLimit;

  const limiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.tokenBucket(capacity, `${refillWindowMs} ms`, capacity),
    prefix: getAiRateLimitPrefix(operation),
  });

  cache.set(operation, limiter);
  return limiter;
}

export const createAiRateLimitMiddleware = (
  operation,
  { limiter = createAiRateLimiter(operation), logger = console } = {},
) => {
  return async (req, res, next) => {
    if (!req.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const result = await limiter.limit(`user:${req.userId}`);

      if (result.success) return next();

      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      res.set({
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset),
      });
      return res.status(429).json({ message: "Too many AI requests. Please try again later." });
    } catch (error) {
      logger.error("AI rate limiter unavailable", {
        operation,
        userId: String(req.userId),
        error: error instanceof Error ? error.message : "Unknown Redis error",
      });
      return res.status(503).json({ message: "AI service is temporarily unavailable." });
    }
  };
};

export const aiRateLimit = (operation) =>
  createAiRateLimitMiddleware(operation);
