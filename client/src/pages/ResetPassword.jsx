import { Lock } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../configs/api";

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data } = await api.post(`/api/user/reset-password/${token}`, { password });
      toast.success(data.message);
      navigate("/login");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to reset password");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray">
      <form onSubmit={handleSubmit} className="w-full px-8 text-center sm:w-87.5">
        <h1 className="text-3xl font-medium text-black">Choose a new password</h1>
        <p className="mt-2 text-sm text-gray-500">Use at least 8 characters.</p>

        {[{ value: password, setter: setPassword, label: "New password" }, { value: confirmPassword, setter: setConfirmPassword, label: "Confirm new password" }].map((field) => (
          <div key={field.label} className="mt-4 flex h-12 w-full items-center gap-2 rounded-full bg-white/10 pl-6 ring-2 ring-white/10 transition-all focus-within:ring-green-500/60">
            <Lock size={14} color="#6B7280" />
            <input
              type="password"
              value={field.value}
              onChange={(event) => field.setter(event.target.value)}
              placeholder={field.label}
              className="w-full border-none bg-transparent text-white outline-none"
              minLength="8"
              required
            />
          </div>
        ))}

        <button disabled={isSubmitting} type="submit" className="mt-5 h-11 w-full rounded-full bg-green-600 text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-60">
          {isSubmitting ? "Resetting..." : "Reset password"}
        </button>
      </form>
    </div>
  );
};

export default ResetPassword;
