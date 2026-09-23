import User from "../models/User.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Resend } from "resend";
import Resume from "../models/Resume.js";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const RESET_REQUEST_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const getResetUrl = (token) => {
  const clientUrl = process.env.CLIENT_URL?.replace(/\/$/, "");
  return `${clientUrl}/reset-password/${token}`;
};

const generateToken = (userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
  return token;
};

// controller for user registration
// POST: /api/user/register
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: "User already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    // return success message
    const token = generateToken(newUser._id);
    newUser.password = undefined;

    return res
      .status(201)
      .json({ message: "User created successfully", token, user: newUser });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// controller for user login
// POST: /api/user/login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // check if password is correct
    if (!user.comparePassword(password)) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // return success message
    const token = generateToken(user._id);
    user.password = undefined;

    return res.status(200).json({ message: "Login successfully", token, user });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// POST: /api/user/forgot-password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.CLIENT_URL) {
      console.error("Password reset email environment variables are not configured");
      return res.status(200).json({ message: RESET_REQUEST_MESSAGE });
    }

    const user = await User.findOne({ email });

    // Keep the response identical so this endpoint does not reveal accounts.
    if (!user) {
      return res.status(200).json({ message: RESET_REQUEST_MESSAGE });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = hashResetToken(resetToken);
    user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const resetUrl = getResetUrl(resetToken);
      const { error } = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: user.email,
        subject: "Reset your Resume password",
        text: `You requested a password reset. Use this link within 15 minutes: ${resetUrl}`,
      });

      if (error) throw new Error(error.message);
    } catch (error) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      console.error("Password reset email failed:", error.message);
      return res.status(200).json({ message: RESET_REQUEST_MESSAGE });
    }

    return res.status(200).json({ message: RESET_REQUEST_MESSAGE });
  } catch (error) {
    return res.status(500).json({ message: "Unable to process password reset request" });
  }
};

// POST: /api/user/reset-password/:token
export const resetPassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const user = await User.findOne({
      resetPasswordToken: hashResetToken(req.params.token),
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "This reset link is invalid or has expired" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.status(200).json({ message: "Password reset successfully. Please log in." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to reset password" });
  }
};

// controller for getting user by id
// GET: /api/user/data
export const getUserById = async (req, res) => {
  try {
    const userId = req.userId;

    // check if user exits
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // return user
    user.password = undefined;

    return res.status(200).json({ user });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// controller for getting user resumes
// GET: /api/user/resumes
export const getUserResumes = async (req, res) => {
  try {
    const userId = req.userId;

    // return user resumes
    const resumes = await Resume.find({userId})
    return res.status(200).json({resumes})
  } catch (error) {
    return res.status(400).json({ message: error.message})
  }
}
