import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResumeUpdate,
  ResumeUpdateValidationError,
} from "../utils/resumeUpdate.js";

test("allows normal editor fields while discarding database metadata", () => {
  const update = buildResumeUpdate({
    _id: "resume-id",
    userId: "another-user",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    __v: 0,
    title: "Frontend Engineer",
    public: true,
    template: "modern",
    accent_color: "#3B82F6",
    personal_info: { _id: "nested-id", full_name: "Ada Lovelace" },
  });

  assert.deepEqual(update, {
    title: "Frontend Engineer",
    public: true,
    template: "modern",
    accent_color: "#3B82F6",
    "personal_info.full_name": "Ada Lovelace",
  });
});

test("allows a partial visibility update", () => {
  assert.deepEqual(buildResumeUpdate({ public: false }), { public: false });
});

test("rejects unknown and invalid editable fields", () => {
  assert.throws(
    () => buildResumeUpdate({ role: "admin" }),
    ResumeUpdateValidationError,
  );
  assert.throws(
    () => buildResumeUpdate({ template: "rainbow" }),
    ResumeUpdateValidationError,
  );
  assert.throws(
    () => buildResumeUpdate({ skills: "React" }),
    ResumeUpdateValidationError,
  );
});

test("adds an uploaded image only at the allowed path", () => {
  assert.deepEqual(buildResumeUpdate({ title: "Resume" }, { imageUrl: "https://cdn/image.png" }), {
    title: "Resume",
    "personal_info.image": "https://cdn/image.png",
  });
});
