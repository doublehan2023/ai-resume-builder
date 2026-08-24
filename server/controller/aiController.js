import ai from "../configs/ai.js";
import Resume from "../models/Resume.js";

// controller for enhancing a resume's professional summary
// POST: /api/ai/enhance-pro-sum
export const enhanceProfessionalSummary = async (req, res) => {
  try {
    const { userContent } = req.body;

    if (!userContent?.trim()) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const response = await ai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert in resume writing. Your task is to enhance the professional summary of a resume. The summary shoule be 1-2 sentences also highlighting key skills, experience, and career objectives. Make it compelling and ATS-friendly. Only return text no options or anything else.",
        },
        { role: "user", content: userContent },
      ],
    });

    const enhancedContent = response.choices[0].message.content;
    if (!enhancedContent?.trim()) {
      return res.status(502).json({ message: "AI returned no content" });
    }

    return res.status(200).json({ enhancedContent });
  } catch (error) {
    const status = error?.status === 429 ? 429 : 502;
    return res.status(status).json({ message: "Unable to enhance summary" });
  }
};

// controller for enhancing a resume's job description
// POST: /api/ai/enhance-job-desc
export const enhanceJobDescription = async (req, res) => {
  try {
    const { userContent } = req.body;

    if (!userContent?.trim()) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const response = await ai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert resume writer. Improve the provided job description into a concise, accomplishment-focused bullet point. Use strong action verbs, preserve only facts supplied by the user, and make the result ATS-friendly. Return only the improved job description with no heading, commentary, or options.",
        },
        { role: "user", content: userContent },
      ],
    });

    const enhancedContent = response.choices[0].message.content;
    if (!enhancedContent?.trim()) {
      return res.status(502).json({ message: "AI returned no content" });
    }

    return res.status(200).json({ enhancedContent });
  } catch (error) {
    const status = error?.status === 429 ? 429 : 502;
    return res
      .status(status)
      .json({ message: "Unable to enhance job description" });
  }
};

// controller for uploading a resume to database
// POST: /api/ai/upload-resume
export const uploadResume = async (req, res) => {
  try {
    const { resumeText, title } = req.body;
    const userId = req.userId;

    if (!resumeText?.trim()) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const systemPrompt =
      "Extract resume data into a JSON object. Return only JSON with these fields: title (string), public (boolean), accent_color (string), professional_summary (string), skills (string array), personal_info ({ image, full_name, profession, email, phone, location, linkedin, website }), experience ({ company, position, start_date, end_date, description, is_current } array), project ({ name, type, description } array), and education ({ institution, degree, field, graduation_date, gpa } array). Omit information not present in the resume and never invent facts.";
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
    const response = await ai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const extractedData = response.choices[0].message.content;
    if (!extractedData?.trim()) {
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

    const newResume = await Resume.create({ ...parsedData, userId, title });
    return res.status(201).json({ resumeId: newResume._id });
  } catch (error) {
    const status = error?.status === 429 ? 429 : 502;
    return res
      .status(status)
      .json({ message: "Unable to extract resume data" });
  }
};
