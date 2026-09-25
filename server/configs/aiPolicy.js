export const AI_OPERATION = Object.freeze({
  // Used by the professional-summary AI endpoint.
  PROFESSIONAL_SUMMARY: "professionalSummary",
  // Used by the individual experience-bullet AI endpoint.
  JOB_DESCRIPTION: "jobDescription",
  // Used by the PDF-text-to-resume extraction endpoint.
  RESUME_IMPORT: "resumeImport",
});

// Small helpers keep duration values readable in the policy below.
const minutes = (value) => value * 60 * 1000;
const hours = (value) => value * 60 * 60 * 1000;

/**
 * Server-owned policy for every AI operation. Controllers must select an
 * operation by name; client requests never supply model or limit settings.
 */
export const AI_POLICY = Object.freeze({
  global: Object.freeze({
    // Maximum model calls running across every user at the same time. Phase 6
    // will enforce this with a shared Redis semaphore.
    concurrencyLimit: 10,
    // Stop waiting for an upstream model response after 25 seconds.
    timeoutMs: 25_000,
    retry: Object.freeze({
      // A failed provider request gets, at most, two additional attempts.
      maxRetries: 2,
      // The first retry waits somewhere between 0 and 500 ms.
      baseDelayMs: 500,
      // Never make a user wait longer than 15 seconds for one retry.
      maxDelayMs: 15_000,
      // Full jitter randomizes retry timing, preventing many clients from
      // retrying together during a provider outage.
      strategy: "full-jitter",
    }),
  }),
  operations: Object.freeze({
    [AI_OPERATION.PROFESSIONAL_SUMMARY]: Object.freeze({
      // Token bucket: users may make up to 10 summary requests in a burst;
      // the bucket refills completely over the following 15 minutes.
      rateLimit: Object.freeze({ capacity: 10, refillWindowMs: minutes(15) }),
      // Limits total daily spend even when a user stays under the short-term
      // rate limit. Phase 7 will persist this in MongoDB.
      dailyQuota: 30,
      // Reject unusually large text before it reaches the provider.
      maxInputChars: 10_000,
      // Resume summaries should be brief, so their generated response has a
      // small token ceiling.
      maxOutputTokens: 350,
    }),
    [AI_OPERATION.JOB_DESCRIPTION]: Object.freeze({
      // A user may work through several job bullets at once, so this endpoint
      // has a higher short-term capacity than summary generation.
      rateLimit: Object.freeze({ capacity: 20, refillWindowMs: minutes(15) }),
      dailyQuota: 60,
      maxInputChars: 10_000,
      // Allows several concise, accomplishment-focused bullets.
      maxOutputTokens: 500,
    }),
    [AI_OPERATION.RESUME_IMPORT]: Object.freeze({
      // Importing a PDF can send much more text to the model and costs more,
      // so it has the strictest request limit.
      rateLimit: Object.freeze({ capacity: 3, refillWindowMs: hours(1) }),
      dailyQuota: 3,
      // This cap is applied to extracted PDF text, not the binary PDF itself.
      maxInputChars: 50_000,
      // Extraction needs enough room for structured data from a full resume.
      maxOutputTokens: 2_000,
    }),
  }),
});

export const getAiOperationPolicy = (operation) => {
  // Controllers must use one of the names above. Rejecting unknown names keeps
  // new endpoints from bypassing the protection policy by accident.
  const policy = AI_POLICY.operations[operation];
  if (!policy) {
    throw new Error(`Unsupported AI operation: ${operation}`);
  }
  return policy;
};

/**
 * The configured model remains a server secret/configuration value. Future
 * AI service code must call this instead of accepting a model from the client.
 */
export const getServerAiModel = () => {
  // Do not accept a model name from req.body. A client could otherwise select
  // a more expensive model or an unsupported provider option.
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model) {
    throw new Error("OPENAI_MODEL environment variable is not set");
  }
  return model;
};
