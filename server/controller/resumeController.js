import getImageKit from "../configs/imageKit.js";
import Resume from "../models/Resume.js";
import fs from "fs";

// controller for creating a new resume
// POST: /api/resumes/create
export const createResume = async (req, res) => {
  try {
    const userId = req.userId;
    const { title } = req.body;

    // create new resumes
    const newResume = await Resume.create({ userId, title });
    // return success message
    return res
      .status(201)
      .json({ message: "Resume created successfully", resume: newResume });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// controller for deleting a resume owned by the authenticated user
// DELETE: /api/resumes/delete
export const deleteResume = async (req, res) => {
  try {
    const userId = req.userId;
    const { resumeId } = req.params;

    if (!resumeId) {
      return res.status(400).json({ message: "Resume ID is required" });
    }

    // Include userId so a user cannot delete another user's resume.
    const resume = await Resume.findOneAndDelete({ _id: resumeId, userId });

    if (!resume) {
      return res.status(404).json({ message: "Resume not found" });
    }

    return res.status(200).json({ message: "Resume deleted successfully" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// get user resumes by id
// GET: /api/resumes/get/:resumeId
export const getResumeById = async (req, res) => {
  try {
    const userId = req.userId;
    const { resumeId } = req.params;

    if (!resumeId) {
      return res.status(400).json({ message: "Resume ID is required" });
    }

    // Include userId so a user can only retrieve their own resume.
    const resume = await Resume.findOne({ _id: resumeId, userId });

    if (!resume) {
      return res.status(404).json({ message: "Resume not found" });
    }

    resume.__v = undefined;
    resume.createdAt = undefined;
    resume.updatedAt = undefined;

    // return success messgae
    return res.status(200).json({ resume });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// get resume by id public
// GET: /api/resumes/public/:resumeId
export const getPublicResumeById = async (req, res) => {
  try {
    const { resumeId } = req.params;

    if (!resumeId) {
      return res.status(400).json({ message: "Resume ID is required" });
    }

    // Public resumes can be viewed without authentication.
    const resume = await Resume.findOne({ _id: resumeId, public: true });

    if (!resume) {
      return res.status(404).json({ message: "Public resume not found" });
    }

    // Do not expose ownership or internal database fields on a public page.
    resume.userId = undefined;
    resume.__v = undefined;
    resume.createdAt = undefined;
    resume.updatedAt = undefined;

    return res.status(200).json({ resume });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// controller for updating resumes
// PUT: /api/resumes/update
export const updateResume = async (req, res) => {
  const image = req.file;

  try {
    const userId = req.userId;
    const { resumeId, resumeData, removeBackground } = req.body;

    if (!resumeId) {
      return res.status(400).json({ message: "Resume ID is required" });
    }

    // `multipart/form-data` sends nested data as a JSON string, while a normal
    // JSON request provides it as an object. Support both update paths.
    const parsedResumeData =
      typeof resumeData === "string" ? JSON.parse(resumeData) : resumeData;

    if (!parsedResumeData || typeof parsedResumeData !== "object") {
      return res.status(400).json({ message: "Resume data is required" });
    }

    let resumeDataCopy;
    if (typeof resumeData === 'string'){
      resumeDataCopy = await JSON.parse(resumeData)
    }else{
      resumeDataCopy = structuredClone(resumeData)
    }

    if (image) {
      const response = await getImageKit().files.upload({
        // ImageKit's v7 SDK accepts a file stream; passing a raw Buffer causes
        // the SDK to serialize it as an object and ImageKit rejects it with 400.
        file: fs.createReadStream(image.path),
        fileName: "resume.png",
        folder: "user-resumes",
        transformation: {
          pre:
            "w-300, h-300, fo-face,z-0.75" +
            (removeBackground === "true" ? `,e-bgremove` : ""),
        },
      });

      resumeDataCopy.personal_info.image = response.url;
    }

    const resume = await Resume.findOneAndUpdate(
      { _id: resumeId, userId },
      resumeDataCopy,
      { new: true, runValidators: true },
    );

    if (!resume) {
      return res.status(404).json({ message: "Resume not found" });
    }

    return res.status(200).json({
      message: "Resume updated successfully",
      resume,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  } finally {
    // Multer stores uploads temporarily on disk; remove the file after use.
    if (image?.path) {
      await fs.promises.unlink(image.path).catch(() => {});
    }
  }
};
