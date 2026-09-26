import { AI_OPERATION } from "../configs/aiPolicy.js";
import Resume from "../models/Resume.js";
import {
  AI_EXECUTION_ERROR_CODE,
  executeAiOperation,
} from "../services/aiExecution.js";

const AI_ERROR_RESPONSES = Object.freeze({
  [AI_EXECUTION_ERROR_CODE.TIMEOUT]: Object.freeze({
    status: 504,
    message: "AI request timed out. Please try again.",
  }),
  [AI_EXECUTION_ERROR_CODE.RATE_LIMITED]: Object.freeze({
    status: 429,
    message: "AI rate limit reached. Please try again shortly.",
  }),
  [AI_EXECUTION_ERROR_CODE.UNAVAILABLE]: Object.freeze({
    status: 503,
    message: "AI service is temporarily unavailable. Please try again shortly.",
  }),
  [AI_EXECUTION_ERROR_CODE.CONFIGURATION]: Object.freeze({
    status: 500,
    message: "AI service is temporarily unavailable.",
  }),
  [AI_EXECUTION_ERROR_CODE.REQUEST_FAILED]: Object.freeze({
    status: 502,
    message: "Unable to complete the AI request.",
  }),
});

export const getAiExecutionHttpError = (
  error,
  fallbackMessage = "Unable to complete the AI request.",
) => {
  const mapped = AI_ERROR_RESPONSES[error?.code];
  if (mapped) {
    return {
      status: mapped.status,
      body: { message: mapped.message, code: error.code },
    };
  }

  return { status: 502, body: { message: fallbackMessage } };
};

const sendAiExecutionError = (res, error, fallbackMessage) => {
  const response = getAiExecutionHttpError(error, fallbackMessage);
  return res.status(response.status).json(response.body);
};

const isNonEmptyText = (value) =>
  typeof value === "string" && value.trim().length > 0;

const getGeneratedContent = (response) =>
  response?.choices?.[0]?.message?.content;

export const createAiControllers = ({
  execute = executeAiOperation,
  ResumeModel = Resume,
} = {}) => {

// controller for enhancing a resume's professional summary
// POST: /api/ai/enhance-pro-sum
const enhanceProfessionalSummary = async (req, res) => {
  try {
    const { userContent } = req.body;

    if (!isNonEmptyText(userContent)) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const response = await execute({
      operation: AI_OPERATION.PROFESSIONAL_SUMMARY,
      messages: [
        {
          role: "system",
          content:
            "You are an expert in resume writing. Your task is to enhance the professional summary of a resume. The summary shoule be 1-2 sentences also highlighting key skills, experience, and career objectives. Make it compelling and ATS-friendly. Only return text no options or anything else.",
        },
        { role: "user", content: userContent },
      ],
    });

    const enhancedContent = getGeneratedContent(response);
    if (!isNonEmptyText(enhancedContent)) {
      return res.status(502).json({ message: "AI returned no content" });
    }

    return res.status(200).json({ enhancedContent });
  } catch (error) {
    return sendAiExecutionError(res, error, "Unable to enhance summary");
  }
};

// controller for enhancing a resume's job description
// POST: /api/ai/enhance-job-desc
const enhanceJobDescription = async (req, res) => {
  try {
    const { userContent } = req.body;

    if (!isNonEmptyText(userContent)) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const response = await execute({
      operation: AI_OPERATION.JOB_DESCRIPTION,
      messages: [
        {
          role: "system",
          content:
            "You are an expert resume writer. Improve the provided job description into a concise, accomplishment-focused bullet point. Use strong action verbs, preserve only facts supplied by the user, and make the result ATS-friendly. Return only the improved job description with no heading, commentary, or options.",
        },
        { role: "user", content: userContent },
      ],
    });

    const enhancedContent = getGeneratedContent(response);
    if (!isNonEmptyText(enhancedContent)) {
      return res.status(502).json({ message: "AI returned no content" });
    }

    return res.status(200).json({ enhancedContent });
  } catch (error) {
    return sendAiExecutionError(
      res,
      error,
      "Unable to enhance job description",
    );
  }
};

// controller for uploading a resume to database
// POST: /api/ai/upload-resume
const uploadResume = async (req, res) => {
  try {
    const { resumeText, title } = req.body;
    const userId = req.userId;

    if (!isNonEmptyText(resumeText) || !isNonEmptyText(title)) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const systemPrompt =
      "Extract resume data into a JSON object. Return only JSON with these fields: title (string), public (boolean), accent_color (string), professional_summary (string), skills (string array), personal_info ({ image, full_name, profession, email, phone, location, linkedin, website }), experience ({ company, position, start_date, end_date, description, is_current } array), project ({ name, type, link, description } array), and education ({ institution, degree, field, graduation_date, gpa } array). Extract a project link only when it is explicitly present in the resume; never invent one. Omit information not present in the resume and never invent facts.";
    const userPrompt = `extract data from this resume: ${resumeText}
    Provide data in the following JSON format with no additional text before or after:
    {
     professional_summary: { type: String, default: "" },
     skills: [{ type: String }],
     personal_info: {
          image: { type: String, default: "" },
          full_name: { type: String, default: "" },
          profession: { type: String, default: "" },
          email: { type: String, default: "" },
          phone: { type: String, default: "" },
          location: { type: String, default: "" },
          linkedin: { type: String, default: "" },
          website: { type: String, default: "" },
     },
     experience: [
          {
          company: { type: String },
          position: { type: String },
          start_date: { type: String },
          end_date: { type: String },
          description: { type: String },
          is_current: { type: Boolean },
          },
     ],
     project: [
          {
          name: { type: String },
          type: { type: String },
          link: { type: String },
          description: { type: String },
          },
     ],
     education: [
          {
          institution: { type: String },
          degree: { type: String },
          field: { type: String },
          graduation_date: { type: String },
          gpa: { type: String },
          },
     ],
  }`;
    const response = await execute({
      operation: AI_OPERATION.RESUME_IMPORT,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: userPrompt },
      ],
      responseFormat: { type: "json_object" },
    });

    const extractedData = getGeneratedContent(response);
    if (!isNonEmptyText(extractedData)) {
      return res.status(502).json({ message: "AI returned no content" });
    }

    let parsedData;
    try {
      parsedData = JSON.parse(extractedData);
    } catch {
      return res
        .status(502)
        .json({ message: "AI returned invalid resume data" });
    }

    if (
      !parsedData ||
      Array.isArray(parsedData) ||
      typeof parsedData !== "object"
    ) {
      return res
        .status(502)
        .json({ message: "AI returned invalid resume data" });
    }

    const newResume = await ResumeModel.create({ ...parsedData, userId, title });
    return res.status(201).json({ resumeId: newResume._id });
  } catch (error) {
    return sendAiExecutionError(res, error, "Unable to extract resume data");
  }
};

  return {
    enhanceProfessionalSummary,
    enhanceJobDescription,
    uploadResume,
  };
};

export const {
  enhanceProfessionalSummary,
  enhanceJobDescription,
  uploadResume,
} = createAiControllers();
