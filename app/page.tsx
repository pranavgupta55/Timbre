"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Eyebrow, DataCard } from "@/components/ui/TacticalUI";

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    
    // DEV BYPASS: Allows you to view the app while using placeholder Supabase keys
    if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder")) {
        router.push("/editor"); 
        return;
    }

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: { emailRedirectTo: window.location.origin }
      });
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg("System initialized. Check email to verify operator status.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMsg(error.message);
      } else {
        router.push("/reel");
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-md space-y-8">
        <div>
          <Eyebrow title={isSignUp ? "SYSTEM REGISTRATION" : "SYSTEM ACCESS"} />
          <h1 className="font-serif text-5xl text-text-main" style={{ fontFamily: "var(--font-glosa)" }}>
            {isSignUp ? "Initialize" : "Authentication"}
          </h1>
        </div>
        
        <form onSubmit={handleAuth} className="rounded-xl border border-border-light bg-bg-panel p-6 shadow-2xl backdrop-blur-md flex flex-col">
          
          <div className="space-y-4 mb-6">
            <div className="space-y-1 flex flex-col">
              <label htmlFor="email" className="font-sans text-[10px] uppercase text-text-dim tracking-widest">
                Operator Email
              </label>
              <input 
                id="email"
                name="email"
                autoComplete="email"
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                className="w-full font-mono text-sm bg-bg-base border border-border-light px-3 py-2 text-text-main focus:border-accent-green focus:outline-none transition-colors" 
                required 
              />
            </div>
            
            <div className="space-y-1 flex flex-col">
              <label htmlFor="password" className="font-sans text-[10px] uppercase text-text-dim tracking-widest">
                Passcode
              </label>
              <input 
                id="password"
                name="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="w-full font-mono text-sm bg-bg-base border border-border-light px-3 py-2 text-text-main focus:border-accent-green focus:outline-none transition-colors" 
                required 
              />
            </div>
          </div>

          {errorMsg && (
            <div className="text-accent-red font-mono text-[10px] uppercase tracking-wider mb-4 border border-accent-red/20 bg-accent-red/10 px-3 py-2 rounded">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="text-accent-green font-mono text-[10px] uppercase tracking-wider mb-4 border border-accent-green/20 bg-accent-green/10 px-3 py-2 rounded">
              {successMsg}
            </div>
          )}

          <DataCard 
            label={isSignUp ? "CREATE OPERATOR ACCOUNT" : "INITIALIZE LOGIN"} 
            type="submit" 
            state="default" 
          />

          <button 
            type="button" 
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMsg("");
              setSuccessMsg("");
            }} 
            className="font-mono text-[10px] text-text-dim hover:text-text-main mt-5 text-center tracking-widest uppercase transition-colors"
          >
            {isSignUp ? "[ ABORT: RETURN TO LOGIN ]" : "[ NO ACCOUNT? INITIATE REGISTRATION ]"}
          </button>
        </form>
      </div>
    </div>
  );
}