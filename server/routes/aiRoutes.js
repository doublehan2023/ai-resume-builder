import express from "express";
import protect from "../middlewares/authMiddleware.js";
import { AI_OPERATION } from "../configs/aiPolicy.js";
import { aiRateLimit } from "../middlewares/aiRateLimit.js";
import {
  enhanceJobDescription,
  enhanceProfessionalSummary,
  uploadResume,
} from "../controller/aiController.js";

const aiRouter = express.Router();

aiRouter.post(
  "/enhance-pro-sum",
  protect,
  aiRateLimit(AI_OPERATION.PROFESSIONAL_SUMMARY),
  enhanceProfessionalSummary,
);
aiRouter.post(
  "/enhance-job-desc",
  protect,
  aiRateLimit(AI_OPERATION.JOB_DESCRIPTION),
  enhanceJobDescription,
);
aiRouter.post(
  "/upload-resume",
  protect,
  aiRateLimit(AI_OPERATION.RESUME_IMPORT),
  uploadResume,
);

export default aiRouter;
