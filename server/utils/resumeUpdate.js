import { z } from "zod";

const serverManagedFields = {
  _id: z.unknown().optional(),
  id: z.unknown().optional(),
  userId: z.unknown().optional(),
  createdAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
  __v: z.unknown().optional(),
};

const text = (max = 10_000) => z.string().trim().max(max);
const month = z.string().regex(/^$|^\d{4}-(0[1-9]|1[0-2])$/, {
  message: "must use YYYY-MM format",
});

const personalInfoSchema = z.object({
  ...serverManagedFields,
  // Accepted for a full editor save, but never persisted from the client.
  image: text(2_048).optional(),
  full_name: text(200).optional(),
  profession: text(200).optional(),
  email: text(320).optional(),
  phone: text(50).optional(),
  location: text(200).optional(),
  linkedin: text(2_048).optional(),
  website: text(2_048).optional(),
}).strict();

const experienceSchema = z.object({
  ...serverManagedFields,
  company: text(200).optional(),
  position: text(200).optional(),
  start_date: month.optional(),
  end_date: month.optional(),
  description: text().optional(),
  is_current: z.boolean().optional().default(false),
}).strict();

const projectSchema = z.object({
  ...serverManagedFields,
  name: text(200).optional(),
  type: text(200).optional(),
  description: text().optional(),
}).strict();

const educationSchema = z.object({
  ...serverManagedFields,
  institution: text(300).optional(),
  degree: text(300).optional(),
  field: text(300).optional(),
  graduation_date: month.optional(),
  gpa: text(30).optional(),
}).strict();

const resumeUpdateSchema = z.object({
  ...serverManagedFields,
  title: text(200).optional(),
  public: z.boolean().optional(),
  template: z.enum(["classic", "modern", "minimal", "minimal-image"]).optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, {
    message: "must be a six-digit hex color",
  }).optional(),
  professional_summary: text().optional(),
  skills: z.array(text(200)).max(100).optional(),
  personal_info: personalInfoSchema.optional(),
  experience: z.array(experienceSchema).max(100).optional(),
  project: z.array(projectSchema).max(100).optional(),
  education: z.array(educationSchema).max(100).optional(),
}).strict();

export class ResumeUpdateValidationError extends Error {}

const fail = (message) => {
  throw new ResumeUpdateValidationError(message);
};

const parseUpdate = (payload) => {
  const result = resumeUpdateSchema.safeParse(payload);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue.path.length ? issue.path.join(".") : "resumeData";
  fail(`${path}: ${issue.message}`);
};

const sanitizeNestedObject = (value, excludedFields = []) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) =>
        !(key in serverManagedFields) && !excludedFields.includes(key) && entry !== undefined,
    ),
  );

/**
 * Converts a validated client payload to a MongoDB $set document. Server-owned
 * metadata and client-provided image URLs never enter the persistence surface.
 */
export const buildResumeUpdate = (payload, { imageUrl, allowEmpty = false } = {}) => {
  const data = parseUpdate(payload);
  const update = {};

  for (const field of [
    "title",
    "public",
    "template",
    "accent_color",
    "professional_summary",
    "skills",
  ]) {
    if (data[field] !== undefined) update[field] = data[field];
  }

  for (const field of ["experience", "project", "education"]) {
    if (data[field] !== undefined) {
      update[field] = data[field].map((entry) => sanitizeNestedObject(entry));
    }
  }

  if (data.personal_info) {
    for (const [key, value] of Object.entries(
      sanitizeNestedObject(data.personal_info, ["image"]),
    )) {
      update[`personal_info.${key}`] = value;
    }
  }

  if (imageUrl) update["personal_info.image"] = imageUrl;
  if (Object.keys(update).length === 0 && !allowEmpty) {
    fail("No editable resume fields were provided");
  }

  return update;
};
