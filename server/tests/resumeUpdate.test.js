import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResumeUpdate,
  ResumeUpdateValidationError,
} from "../utils/resumeUpdate.js";

test("allows normal editor fields while excluding protected metadata", () => {
  const update = buildResumeUpdate({
    _id: "resume-id", userId: "another-user", createdAt: "2026-01-01",
    updatedAt: "2026-01-02", __v: 0, title: "Frontend Engineer", public: true,
    template: "modern", accent_color: "#3B82F6",
    personal_info: { _id: "nested-id", full_name: "Ada Lovelace" },
  });

  assert.deepEqual(update, {
    title: "Frontend Engineer", public: true, template: "modern",
    accent_color: "#3B82F6", "personal_info.full_name": "Ada Lovelace",
  });
});

test("allows partial title and visibility updates", () => {
  assert.deepEqual(buildResumeUpdate({ public: false }), { public: false });
  assert.deepEqual(buildResumeUpdate({ title: "Updated" }), { title: "Updated" });
});

test("rejects unknown fields, invalid enums, and invalid nested shapes", () => {
  for (const payload of [
    { role: "admin" }, { template: "rainbow" }, { skills: "React" },
    { experience: [{ company: "Acme", is_current: "false" }] },
    { education: [{ graduation_date: "2026-13" }] },
    { personal_info: { full_name: "Ada", role: "admin" } },
  ]) {
    assert.throws(() => buildResumeUpdate(payload), ResumeUpdateValidationError);
  }
});

test("does not persist a client-supplied image URL", () => {
  assert.deepEqual(
    buildResumeUpdate({
      title: "Resume",
      personal_info: { image: "https://attacker.invalid/a" },
    }),
    { title: "Resume" },
  );
});

test("strips server-managed metadata from nested collection entries", () => {
  const protectedFields = {
    _id: "attacker-id",
    id: "attacker-id",
    userId: "attacker-user-id",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    __v: 99,
  };

  const update = buildResumeUpdate({
    experience: [{ ...protectedFields, company: "Acme", position: "Engineer" }],
    project: [{ ...protectedFields, name: "Portfolio" }],
    education: [{ ...protectedFields, institution: "University" }],
  });

  assert.deepEqual(update, {
    experience: [{ company: "Acme", position: "Engineer", is_current: false }],
    project: [{ name: "Portfolio" }],
    education: [{ institution: "University" }],
  });
});

test("adds an uploaded image only at the allowed path", () => {
  assert.deepEqual(
    buildResumeUpdate({ title: "Resume" }, { imageUrl: "https://cdn/image.png" }),
    { title: "Resume", "personal_info.image": "https://cdn/image.png" },
  );
});

test("permits an image-only update only when the server supplies the image URL", () => {
  assert.deepEqual(
    buildResumeUpdate({}, { imageUrl: "https://cdn/image.png" }),
    { "personal_info.image": "https://cdn/image.png" },
  );
  assert.deepEqual(buildResumeUpdate({}, { allowEmpty: true }), {});
});
