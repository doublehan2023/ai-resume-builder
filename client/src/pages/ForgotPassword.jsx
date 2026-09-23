import { Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../configs/api";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const { data } = await api.post("/api/user/forgot-password", { email });
      setIsSent(true);
      toast.success(data.message);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to send reset email");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray">
      <form onSubmit={handleSubmit} className="w-full px-8 text-center sm:w-87.5">
        <h1 className="text-3xl font-medium text-black">Reset password</h1>
        <p className="mt-2 text-sm text-gray-500">
          {isSent
            ? "Check your inbox for a password reset link."
            : "Enter your email and we will send a reset link if an account exists."}
        </p>

        {!isSent && (
          <>
            <div className="mt-6 flex h-12 w-full items-center gap-2 rounded-full bg-white/10 pl-6 ring-2 ring-white/10 transition-all focus-within:ring-green-500/60">
              <Mail size={14} color="#6B7280" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                className="w-full border-none bg-transparent text-white outline-none"
                required
              />
            </div>
            <button disabled={isSubmitting} type="submit" className="mt-5 h-11 w-full rounded-full bg-green-600 text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-60">
              {isSubmitting ? "Sending..." : "Send reset link"}
            </button>
          </>
        )}

        <Link to="/login" className="mt-5 inline-block text-sm text-green-500 hover:underline">
          Back to login
        </Link>
      </form>
    </div>
  );
};

export default ForgotPassword;
