import express from "express";
import protect from "../middlewares/authMiddleware.js";
import {
  createResume,
  deleteResume,
  getPublicResumeById,
  getResumeById,
  updateResume,
} from "../controller/resumeController.js";
import upload from "../configs/multer.js";
const resumeRouter = express.Router();

const uploadProfileImage = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) return res.status(400).json({ message: error.message });
    next();
  });
};

resumeRouter.post("/create", protect, createResume);
resumeRouter.put("/update", protect, uploadProfileImage, updateResume);
resumeRouter.delete("/delete/:resumeId", protect, deleteResume);
resumeRouter.get("/get/:resumeId", protect, getResumeById);
resumeRouter.get("/public/:resumeId", getPublicResumeById);

export default resumeRouter;
