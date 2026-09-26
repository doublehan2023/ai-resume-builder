import assert from "node:assert/strict";
import test from "node:test";
import {
  createAiControllers,
  enhanceJobDescription,
  enhanceProfessionalSummary,
  getAiExecutionHttpError,
  uploadResume,
} from "../controller/aiController.js";
import { AI_OPERATION } from "../configs/aiPolicy.js";
import {
  AI_EXECUTION_ERROR_CODE,
  AiExecutionTimeoutError,
  AiRateLimitedError,
  AiUnavailableError,
} from "../services/aiExecution.js";

const response = () => {
  const result = { statusCode: undefined, body: undefined };
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

test("maps execution error codes to consistent client-safe responses", () => {
  const cases = [
    [AI_EXECUTION_ERROR_CODE.TIMEOUT, 504, "AI request timed out. Please try again."],
    [AI_EXECUTION_ERROR_CODE.RATE_LIMITED, 429, "AI rate limit reached. Please try again shortly."],
    [AI_EXECUTION_ERROR_CODE.UNAVAILABLE, 503, "AI service is temporarily unavailable. Please try again shortly."],
    [AI_EXECUTION_ERROR_CODE.CONFIGURATION, 500, "AI service is temporarily unavailable."],
    [AI_EXECUTION_ERROR_CODE.REQUEST_FAILED, 502, "Unable to complete the AI request."],
  ];

  for (const [code, status, message] of cases) {
    assert.deepEqual(getAiExecutionHttpError({ code }), {
      status,
      body: { message, code },
    });
  }
});

test("uses an endpoint-safe fallback for non-execution errors", () => {
  assert.deepEqual(
    getAiExecutionHttpError(
      new Error("database hostname and credential details"),
      "Unable to extract resume data",
    ),
    {
      status: 502,
      body: { message: "Unable to extract resume data" },
    },
  );
});

test("returns 400 for invalid summary and job-description input types", async () => {
  for (const controller of [enhanceProfessionalSummary, enhanceJobDescription]) {
    for (const userContent of [undefined, null, "", "   ", 42, {}]) {
      const res = response();
      await controller({ body: { userContent } }, res);

      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { message: "Missing required fields" });
    }
  }
});

test("returns 400 when resume import text or title is invalid", async () => {
  for (const body of [
    {},
    { resumeText: "Resume text" },
    { title: "My resume" },
    { resumeText: 42, title: "My resume" },
    { resumeText: "Resume text", title: {} },
    { resumeText: "   ", title: "My resume" },
    { resumeText: "Resume text", title: "   " },
  ]) {
    const res = response();
    await uploadResume({ body, userId: "user-123" }, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: "Missing required fields" });
  }
});

test("summary and job-description controllers use the correct operation and success response", async () => {
  const cases = [
    {
      controller: "enhanceProfessionalSummary",
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      content: "Improved professional summary",
    },
    {
      controller: "enhanceJobDescription",
      operation: AI_OPERATION.JOB_DESCRIPTION,
      content: "Improved accomplishment bullet",
    },
  ];

  for (const value of cases) {
    const requests = [];
    const controllers = createAiControllers({
      execute: async (request) => {
        requests.push(request);
        return { choices: [{ message: { content: value.content } }] };
      },
    });
    const res = response();

    await controllers[value.controller](
      { body: { userContent: "Original content" } },
      res,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].operation, value.operation);
    assert.equal(requests[0].messages.at(-1).content, "Original content");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { enhancedContent: value.content });
  }
});

test("resume import requests structured JSON and preserves its success response", async () => {
  const requests = [];
  const created = [];
  const extractedResume = {
    professional_summary: "Software engineer",
    skills: ["JavaScript"],
  };
  const controllers = createAiControllers({
    execute: async (request) => {
      requests.push(request);
      return {
        choices: [{ message: { content: JSON.stringify(extractedResume) } }],
      };
    },
    ResumeModel: {
      create: async (resume) => {
        created.push(resume);
        return { _id: "resume-123" };
      },
    },
  });
  const res = response();

  await controllers.uploadResume(
    {
      userId: "user-123",
      body: { title: "Backend Resume", resumeText: "Original resume text" },
    },
    res,
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].operation, AI_OPERATION.RESUME_IMPORT);
  assert.deepEqual(requests[0].responseFormat, { type: "json_object" });
  assert.match(requests[0].messages.at(-1).content, /Original resume text/);
  assert.deepEqual(created, [{
    ...extractedResume,
    userId: "user-123",
    title: "Backend Resume",
  }]);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { resumeId: "resume-123" });
});

test("every controller maps timeout, rate-limit, and unavailable errors consistently", async () => {
  const errors = [
    [new AiExecutionTimeoutError(25_000), 504, AI_EXECUTION_ERROR_CODE.TIMEOUT],
    [new AiRateLimitedError(), 429, AI_EXECUTION_ERROR_CODE.RATE_LIMITED],
    [new AiUnavailableError(), 503, AI_EXECUTION_ERROR_CODE.UNAVAILABLE],
  ];

  for (const [error, status, code] of errors) {
    const controllers = createAiControllers({
      execute: async () => {
        throw error;
      },
      ResumeModel: {
        create: async () => assert.fail("resume must not be persisted after an execution error"),
      },
    });
    const requests = [
      [controllers.enhanceProfessionalSummary, { body: { userContent: "Summary" } }],
      [controllers.enhanceJobDescription, { body: { userContent: "Job" } }],
      [controllers.uploadResume, {
        userId: "user-123",
        body: { title: "Resume", resumeText: "Resume text" },
      }],
    ];

    for (const [controller, req] of requests) {
      const res = response();
      await controller(req, res);

      assert.equal(res.statusCode, status);
      assert.equal(res.body.code, code);
      assert.equal(typeof res.body.message, "string");
    }
  }
});

test("summary and job-description controllers reject empty or malformed model output", async () => {
  for (const providerResponse of [
    {},
    { choices: [] },
    { choices: [{ message: {} }] },
    { choices: [{ message: { content: "   " } }] },
    { choices: [{ message: { content: 42 } }] },
  ]) {
    const controllers = createAiControllers({
      execute: async () => providerResponse,
    });

    for (const controller of [
      controllers.enhanceProfessionalSummary,
      controllers.enhanceJobDescription,
    ]) {
      const res = response();
      await controller({ body: { userContent: "Original content" } }, res);

      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, { message: "AI returned no content" });
    }
  }
});

test("resume import rejects empty, malformed, and non-object model output", async () => {
  const cases = [
    [{}, "AI returned no content"],
    [{ choices: [{ message: { content: "   " } }] }, "AI returned no content"],
    [{ choices: [{ message: { content: "not-json" } }] }, "AI returned invalid resume data"],
    [{ choices: [{ message: { content: "[]" } }] }, "AI returned invalid resume data"],
    [{ choices: [{ message: { content: "null" } }] }, "AI returned invalid resume data"],
  ];

  for (const [providerResponse, message] of cases) {
    let createCalled = false;
    const controllers = createAiControllers({
      execute: async () => providerResponse,
      ResumeModel: {
        create: async () => {
          createCalled = true;
        },
      },
    });
    const res = response();

    await controllers.uploadResume(
      {
        userId: "user-123",
        body: { title: "Resume", resumeText: "Resume text" },
      },
      res,
    );

    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { message });
    assert.equal(createCalled, false);
  }
});
