"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder")) {
        router.push("/menu");
        return;
      }

      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        setSuccessMessage("Check your email to finish creating the account.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMessage(error.message);
        return;
      }

      router.push("/menu");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <div className="editor-surface w-full max-w-[440px] rounded-[32px] p-6 sm:p-7">
        <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-accent-red">
          {isSignUp ? "Create account" : "Sign in"}
        </div>
        <h1 className="mt-2 font-serif text-3xl text-text-main sm:text-4xl">Timbre</h1>
        <p className="mt-3 font-sans text-sm leading-6 text-text-dim">
          {isSignUp ? "Create an account to save highlights and manage the library." : "Sign in to continue to the workspace."}
        </p>

        <form onSubmit={handleAuth} className="mt-6 space-y-4">
          <label className="block">
            <div className="mb-1.5 font-sans text-xs text-text-dim">Email</div>
            <input
              id="auth-email"
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-text-main outline-none transition-colors focus:border-accent-gold/30"
            />
          </label>

          <label className="block">
            <div className="mb-1.5 font-sans text-xs text-text-dim">Password</div>
            <input
              id="auth-password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-text-main outline-none transition-colors focus:border-accent-gold/30"
            />
          </label>

          {errorMessage ? (
            <div className="rounded-[20px] border border-accent-red/20 bg-accent-red/10 px-4 py-3 font-sans text-sm text-accent-red">
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div className="rounded-[20px] border border-accent-green/20 bg-accent-green/10 px-4 py-3 font-sans text-sm text-accent-green">
              {successMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-accent-gold/25 bg-accent-gold/12 px-4 py-3 text-sm text-accent-gold transition-colors hover:bg-accent-gold/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-text-dim"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {isSignUp ? "Create account" : "Continue"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setIsSignUp((current) => !current);
            setErrorMessage("");
            setSuccessMessage("");
          }}
          className="mt-4 w-full text-center font-sans text-sm text-text-dim transition-colors hover:text-text-main"
        >
          {isSignUp ? "Back to sign in" : "Create an account"}
        </button>
      </div>
    </div>
  );
}
