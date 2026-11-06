import OpenAI from "openai";

let ai;

const getAI = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  if (!ai) {
    ai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      // Phase 6A owns retry classification, backoff, and the total timeout
      // budget. Disable SDK retries so one application attempt always maps to
      // exactly one upstream request.
      maxRetries: 0,
    });
  }

  return ai;
};

export default getAI;
