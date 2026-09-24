import assert from "node:assert/strict";
import test from "node:test";
import Resume from "../models/Resume.js";
import { updateResume } from "../controller/resumeController.js";

const response = () => {
  const result = { statusCode: undefined, body: undefined };
  result.status = (statusCode) => {
    result.statusCode = statusCode;
    return { json: (body) => { result.body = body; return result; } };
  };
  return result;
};

test("update endpoint persists only the allowlisted payload", async () => {
  const originalExists = Resume.exists;
  const originalUpdate = Resume.findOneAndUpdate;
  let query;
  let update;

  Resume.exists = async (value) => {
    query = value;
    return { _id: value._id };
  };
  Resume.findOneAndUpdate = async (_query, value) => {
    update = value;
    return { _id: "resume-id", ...value.$set };
  };

  try {
    const res = response();
    await updateResume({
      userId: "owner-id",
      body: {
        resumeId: "resume-id",
        resumeData: JSON.stringify({ title: "Updated", userId: "attacker-id", _id: "other-id" }),
      },
    }, res);

    assert.deepEqual(query, { _id: "resume-id", userId: "owner-id" });
    assert.deepEqual(update, { $set: { title: "Updated" } });
    assert.equal(res.statusCode, 200);
  } finally {
    Resume.exists = originalExists;
    Resume.findOneAndUpdate = originalUpdate;
  }
});

test("update endpoint rejects invalid input before checking ownership", async () => {
  const originalExists = Resume.exists;
  let ownershipChecked = false;
  Resume.exists = async () => {
    ownershipChecked = true;
    return true;
  };

  try {
    const res = response();
    await updateResume({
      userId: "owner-id",
      body: { resumeId: "resume-id", resumeData: JSON.stringify({ public: "true" }) },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /public/);
    assert.equal(ownershipChecked, false);
  } finally {
    Resume.exists = originalExists;
  }
});
