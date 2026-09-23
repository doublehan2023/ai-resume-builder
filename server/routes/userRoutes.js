import express from 'express'
import { forgotPassword, getUserById, getUserResumes, loginUser, registerUser, resetPassword } from '../controller/userController.js';
import protect from '../middlewares/authMiddleware.js';

const userRouter = express.Router();

userRouter.post('/register', registerUser);
userRouter.post('/login', loginUser);
userRouter.post('/forgot-password', forgotPassword);
userRouter.post('/reset-password/:token', resetPassword);
userRouter.get('/data', protect, getUserById);
userRouter.get('/resumes', protect, getUserResumes)

export default userRouter;
