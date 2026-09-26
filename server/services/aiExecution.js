import getAI from "../configs/ai.js";
import {
  AI_POLICY,
  getAiOperationPolicy,
  getServerAiModel,
} from "../configs/aiPolicy.js";

export const AI_EXECUTION_ERROR_CODE = Object.freeze({
  TIMEOUT: "AI_TIMEOUT",
  RATE_LIMITED: "AI_RATE_LIMITED",
  UNAVAILABLE: "AI_UNAVAILABLE",
  CONFIGURATION: "AI_CONFIGURATION_ERROR",
  REQUEST_FAILED: "AI_REQUEST_FAILED",
});

export class AiExecutionError extends Error {
  constructor(message, { code, status, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

export class AiExecutionTimeoutError extends AiExecutionError {
  constructor(timeoutMs, { cause } = {}) {
    super("AI request timed out.", {
      code: AI_EXECUTION_ERROR_CODE.TIMEOUT,
      status: 504,
      cause,
    });
    this.timeoutMs = timeoutMs;
  }
}

export class AiRateLimitedError extends AiExecutionError {
  constructor({ cause } = {}) {
    super("AI provider rate limit reached.", {
      code: AI_EXECUTION_ERROR_CODE.RATE_LIMITED,
      status: 429,
      cause,
    });
  }
}

export class AiUnavailableError extends AiExecutionError {
  constructor({ cause } = {}) {
    super("AI service is temporarily unavailable.", {
      code: AI_EXECUTION_ERROR_CODE.UNAVAILABLE,
      status: 503,
      cause,
    });
  }
}

export class AiConfigurationError extends AiExecutionError {
  constructor({ cause } = {}) {
    super("AI service is not configured.", {
      code: AI_EXECUTION_ERROR_CODE.CONFIGURATION,
      status: 500,
      cause,
    });
  }
}

export class AiRequestFailedError extends AiExecutionError {
  constructor({ cause } = {}) {
    super("AI request failed.", {
      code: AI_EXECUTION_ERROR_CODE.REQUEST_FAILED,
      status: 502,
      cause,
    });
  }
}

const RETRYABLE_HTTP_STATUSES = new Set([
  408,
  429,
  500,
  502,
  503,
  504,
]);

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TEMPORARY_CONFLICT_CODES = new Set([
  "lock_timeout",
  "resource_locked",
  "temporarily_unavailable",
]);

const defaultSleep = (delayMs, { signal } = {}) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timeoutId = globalThis.setTimeout(finish, delayMs);

    signal?.addEventListener("abort", abort, { once: true });
  });

const getHeader = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;

  const matchingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return matchingKey ? headers[matchingKey] : undefined;
};

const getProviderRequestId = (value) =>
  value?._request_id ??
  value?.request_id ??
  getHeader(value?.headers ?? value?.response?.headers, "x-request-id");

const safeLog = (logger, level, message, metadata) => {
  try {
    logger?.[level]?.(message, metadata);
  } catch {
    // Observability must never change the outcome of an AI request.
  }
};

const outcomeForError = (error) => {
  switch (error.code) {
    case AI_EXECUTION_ERROR_CODE.TIMEOUT:
      return "timeout";
    case AI_EXECUTION_ERROR_CODE.RATE_LIMITED:
      return "rate_limited";
    case AI_EXECUTION_ERROR_CODE.UNAVAILABLE:
      return "unavailable";
    case AI_EXECUTION_ERROR_CODE.CONFIGURATION:
      return "configuration_error";
    default:
      return "request_failed";
  }
};

const executionMetadata = ({
  operation,
  attempt,
  providerStatus,
  elapsedMs,
  requestId,
  outcome,
}) => {
  const metadata = { operation, attempt, elapsedMs, outcome };
  if (providerStatus !== undefined) metadata.providerStatus = providerStatus;
  if (requestId) metadata.requestId = requestId;
  return metadata;
};

export const getRetryAfterMs = (error, nowMs = Date.now()) => {
  const headers = error?.headers ?? error?.response?.headers;
  const value = getHeader(headers, "retry-after");
  if (value === undefined || value === null || value === "") return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const retryAt = Date.parse(String(value));
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : undefined;
};

export const getFullJitterDelayMs = (
  retryNumber,
  { baseDelayMs, maxDelayMs, random = Math.random },
) => {
  const maximumDelay = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** retryNumber,
  );
  const randomValue = Math.min(1, Math.max(0, Number(random())));
  return Math.floor(randomValue * maximumDelay);
};

const errorStatus = (error) => {
  const status = error?.status ?? error?.statusCode;
  return typeof status === "number" ? status : undefined;
};

const hasRetryableNetworkFailure = (error) => {
  if (!error || typeof error !== "object") return false;

  if (RETRYABLE_NETWORK_CODES.has(error.code)) return true;
  if (error.name === "APIConnectionError") return true;

  return error.cause && error.cause !== error
    ? hasRetryableNetworkFailure(error.cause)
    : false;
};

export const isRetryableAiError = (error) => {
  if (error instanceof AiExecutionTimeoutError) return false;
  if (error?.name === "AbortError") return false;

  const status = errorStatus(error);
  if (status === 409) {
    const providerCode = error?.code ?? error?.error?.code;
    return (
      error?.retryable === true ||
      TEMPORARY_CONFLICT_CODES.has(providerCode)
    );
  }
  if (status !== undefined && status !== 0) {
    return RETRYABLE_HTTP_STATUSES.has(status);
  }

  return hasRetryableNetworkFailure(error);
};

export const toAiExecutionError = (error) => {
  if (error instanceof AiExecutionError) return error;

  if (errorStatus(error) === 429) {
    return new AiRateLimitedError({ cause: error });
  }

  if (isRetryableAiError(error)) {
    return new AiUnavailableError({ cause: error });
  }

  return new AiRequestFailedError({ cause: error });
};

/**
 * Execute one server-defined AI operation.
 *
 * Provider mechanics that apply to every AI endpoint belong here so
 * controllers cannot select a model or increase an operation's output limit.
 * The deadline is shared by every attempt so retries cannot each receive a
 * fresh timeout budget.
 */
export const executeAiOperation = async (
  { operation, messages, responseFormat },
  dependencies = {},
) => {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let policy;
  let client;
  let model;

  try {
    policy = getAiOperationPolicy(operation);
    client = dependencies.client ?? getAI();
    const getModel = dependencies.getModel ?? getServerAiModel;
    model = getModel();
  } catch (error) {
    const executionError = new AiConfigurationError({ cause: error });
    safeLog(
      logger,
      "error",
      "AI execution finished",
      executionMetadata({
        operation,
        attempt: 0,
        elapsedMs: Math.max(0, now() - startedAt),
        outcome: outcomeForError(executionError),
      }),
    );
    throw executionError;
  }

  const timeoutMs = dependencies.timeoutMs ?? AI_POLICY.global.timeoutMs;
  const maxRetries =
    dependencies.maxRetries ?? AI_POLICY.global.retry.maxRetries;
  const baseDelayMs =
    dependencies.baseDelayMs ?? AI_POLICY.global.retry.baseDelayMs;
  const maxDelayMs =
    dependencies.maxDelayMs ?? AI_POLICY.global.retry.maxDelayMs;
  const scheduleTimeout = dependencies.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout;
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;

  const request = {
    model,
    messages,
    max_tokens: policy.maxOutputTokens,
  };

  if (responseFormat !== undefined) {
    request.response_format = responseFormat;
  }

  const controller = new AbortController();
  const timeoutError = new AiExecutionTimeoutError(timeoutMs);
  const deadlineAt = now() + timeoutMs;
  let timeoutId;
  let attempt = 0;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = scheduleTimeout(() => {
      // Reject independently of the SDK so the deadline still holds if an
      // OpenAI-compatible provider does not react promptly to AbortSignal.
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });

  try {
    let retryCount = 0;

    while (true) {
      attempt += 1;
      const remainingAttemptMs = Math.max(1, deadlineAt - now());
      const providerPromise = Promise.resolve().then(() =>
        client.chat.completions.create(request, {
          signal: controller.signal,
          timeout: remainingAttemptMs,
        }),
      );

      try {
        const response = await Promise.race([providerPromise, timeoutPromise]);
        safeLog(
          logger,
          "info",
          "AI execution finished",
          executionMetadata({
            operation,
            attempt,
            providerStatus: response?.status ?? 200,
            elapsedMs: Math.max(0, now() - startedAt),
            requestId: getProviderRequestId(response),
            outcome: "success",
          }),
        );
        return response;
      } catch (error) {
        const timeoutExpired = controller.signal.aborted;
        const retriesExhausted = retryCount >= maxRetries;

        if (
          timeoutExpired ||
          retriesExhausted ||
          !isRetryableAiError(error)
        ) {
          throw error;
        }

        const retryAfterMs = getRetryAfterMs(error, now());
        const delayMs = retryAfterMs ?? getFullJitterDelayMs(retryCount, {
          baseDelayMs,
          maxDelayMs,
          random,
        });
        const remainingBudgetMs = deadlineAt - now();

        // Do not shorten a provider-requested delay or begin another attempt
        // when the shared deadline would expire before the wait completes.
        if (remainingBudgetMs <= 0) throw timeoutError;
        if (delayMs >= remainingBudgetMs) throw error;

        safeLog(
          logger,
          "warn",
          "AI execution retry scheduled",
          executionMetadata({
            operation,
            attempt,
            providerStatus: errorStatus(error),
            elapsedMs: Math.max(0, now() - startedAt),
            requestId: getProviderRequestId(error),
            outcome: "retrying",
          }),
        );

        retryCount += 1;
        await Promise.race([
          sleep(delayMs, { signal: controller.signal }),
          timeoutPromise,
        ]);
      }
    }
  } catch (error) {
    const executionError = toAiExecutionError(error);
    safeLog(
      logger,
      "error",
      "AI execution finished",
      executionMetadata({
        operation,
        attempt: Math.max(1, attempt),
        providerStatus: errorStatus(error),
        elapsedMs: Math.max(0, now() - startedAt),
        requestId: getProviderRequestId(error),
        outcome: outcomeForError(executionError),
      }),
    );
    throw executionError;
  } finally {
    cancelTimeout(timeoutId);
  }
};
