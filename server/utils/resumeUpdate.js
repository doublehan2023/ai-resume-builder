const editableFields = new Set([
  "title",
  "public",
  "template",
  "accent_color",
  "professional_summary",
  "skills",
  "personal_info",
  "experience",
  "project",
  "education",
]);

const serverManagedFields = new Set([
  "_id",
  "id",
  "userId",
  "createdAt",
  "updatedAt",
  "__v",
]);

const templateNames = new Set(["classic", "modern", "minimal", "minimal-image"]);
const accentColorPattern = /^#[0-9a-fA-F]{6}$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ResumeUpdateValidationError extends Error {}

const fail = (message) => {
  throw new ResumeUpdateValidationError(message);
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validateKeys = (value, allowedKeys, path) => {
  for (const key of Object.keys(value)) {
    if (serverManagedFields.has(key)) continue;
    if (!allowedKeys.has(key)) fail(`Unsupported field: ${path}.${key}`);
  }
};

const stringValue = (value, path) => {
  if (typeof value !== "string") fail(`${path} must be a string`);
  return value.trim();
};

const monthValue = (value, path) => {
  const normalized = stringValue(value, path);
  if (normalized && !monthPattern.test(normalized)) {
    fail(`${path} must use YYYY-MM format`);
  }
  return normalized;
};

const objectUpdate = (value, fields, path) => {
  if (!isPlainObject(value)) fail(`${path} must be an object`);
  const allowedFields = new Set(fields);
  validateKeys(value, allowedFields, path);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !serverManagedFields.has(key))
      .map(([key, entry]) => [key, stringValue(entry, `${path}.${key}`)]),
  );
};

const arrayUpdate = (value, fields, path, normalizeEntry) => {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) fail(`${path}[${index}] must be an object`);
    validateKeys(entry, new Set(fields), `${path}[${index}]`);
    return normalizeEntry(entry, index);
  });
};

/**
 * Converts a client resume payload into a MongoDB $set document. Database
 * metadata is deliberately ignored so a normal editor save can include the
 * Mongoose fields it received while a tampered request cannot persist them.
 */
export const buildResumeUpdate = (payload, { imageUrl } = {}) => {
  if (!isPlainObject(payload)) fail("Resume data must be an object");

  for (const key of Object.keys(payload)) {
    if (serverManagedFields.has(key)) continue;
    if (!editableFields.has(key)) fail(`Unsupported field: ${key}`);
  }

  const update = {};

  if ("title" in payload) update.title = stringValue(payload.title, "title");
  if ("public" in payload) {
    if (typeof payload.public !== "boolean") fail("public must be a boolean");
    update.public = payload.public;
  }
  if ("template" in payload) {
    const template = stringValue(payload.template, "template");
    if (!templateNames.has(template)) fail("template is invalid");
    update.template = template;
  }
  if ("accent_color" in payload) {
    const color = stringValue(payload.accent_color, "accent_color");
    if (!accentColorPattern.test(color)) fail("accent_color must be a hex color");
    update.accent_color = color;
  }
  if ("professional_summary" in payload) {
    update.professional_summary = stringValue(
      payload.professional_summary,
      "professional_summary",
    );
  }
  if ("skills" in payload) {
    if (!Array.isArray(payload.skills)) fail("skills must be an array");
    update.skills = payload.skills.map((skill, index) =>
      stringValue(skill, `skills[${index}]`),
    );
  }
  if ("personal_info" in payload) {
    const personalInfo = objectUpdate(
      payload.personal_info,
      ["image", "full_name", "profession", "email", "phone", "location", "linkedin", "website"],
      "personal_info",
    );
    for (const [key, value] of Object.entries(personalInfo)) {
      update[`personal_info.${key}`] = value;
    }
  }
  if ("experience" in payload) {
    update.experience = arrayUpdate(
      payload.experience,
      ["company", "position", "start_date", "end_date", "description", "is_current"],
      "experience",
      (entry, index) => ({
        company: stringValue(entry.company ?? "", `experience[${index}].company`),
        position: stringValue(entry.position ?? "", `experience[${index}].position`),
        start_date: monthValue(entry.start_date ?? "", `experience[${index}].start_date`),
        end_date: monthValue(entry.end_date ?? "", `experience[${index}].end_date`),
        description: stringValue(entry.description ?? "", `experience[${index}].description`),
        is_current: typeof entry.is_current === "boolean" ? entry.is_current : false,
      }),
    );
  }
  if ("project" in payload) {
    update.project = arrayUpdate(
      payload.project,
      ["name", "type", "description"],
      "project",
      (entry, index) => ({
        name: stringValue(entry.name ?? "", `project[${index}].name`),
        type: stringValue(entry.type ?? "", `project[${index}].type`),
        description: stringValue(entry.description ?? "", `project[${index}].description`),
      }),
    );
  }
  if ("education" in payload) {
    update.education = arrayUpdate(
      payload.education,
      ["institution", "degree", "field", "graduation_date", "gpa"],
      "education",
      (entry, index) => ({
        institution: stringValue(entry.institution ?? "", `education[${index}].institution`),
        degree: stringValue(entry.degree ?? "", `education[${index}].degree`),
        field: stringValue(entry.field ?? "", `education[${index}].field`),
        graduation_date: monthValue(
          entry.graduation_date ?? "",
          `education[${index}].graduation_date`,
        ),
        gpa: stringValue(entry.gpa ?? "", `education[${index}].gpa`),
      }),
    );
  }

  if (imageUrl) update["personal_info.image"] = imageUrl;
  if (Object.keys(update).length === 0) fail("No editable resume fields were provided");

  return update;
};
