"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
    supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export default function LoginPage() {
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const signInWithGoogle = async () => {
        if (!supabase) {
            setMsg("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
            return;
        }

        setMsg(null);
        setLoading(true);

        const redirectTo = `${window.location.origin}/auth/callback`;

        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
        });

        if (error) {
            setMsg(error.message);
            setLoading(false);
        }
        // If success, browser will redirect away to Google.
    };

    return (
        <main className="min-h-screen text-slate-100 flex items-center justify-center p-6 bg-slate-950">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-20 right-[-10%] h-64 w-64 rounded-full bg-amber-300/10 blur-[90px]" />
                <div className="absolute bottom-[-20%] left-[-10%] h-80 w-80 rounded-full bg-sky-400/10 blur-[120px]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_55%),radial-gradient(circle_at_10%_80%,rgba(251,191,36,0.12),transparent_60%)]" />
            </div>

            <div className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-slate-900/60 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.5)] backdrop-blur">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                            Welcome
                        </p>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                            The Humor Project
                        </h1>
                        <p className="mt-3 text-sm text-slate-300">
                            Sign in with Google to unlock the lexicon map.
                        </p>
                    </div>
                    <div className="h-12 w-12 rounded-2xl border border-white/10 bg-white/5 p-2">
                        <div className="h-full w-full rounded-xl bg-gradient-to-br from-amber-300/60 via-orange-400/60 to-rose-500/60" />
                    </div>
                </div>

                <div className="mt-8 space-y-4">
                    <button
                        onClick={signInWithGoogle}
                        disabled={loading || !supabase}
                        className="group flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white text-slate-950 px-5 py-3 font-semibold transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(255,255,255,0.2)] disabled:opacity-50"
                    >
                        <span>{loading ? "Opening Google…" : "Continue with Google"}</span>
                        <span className="text-xs uppercase tracking-[0.2em] text-slate-500 group-hover:text-slate-700">
                            OAuth
                        </span>
                    </button>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-xs text-slate-400">
                        Redirect: <span className="font-mono">/auth/callback</span>
                    </div>
                </div>

                {msg && (
                    <p className="mt-4 text-sm text-red-300">
                        Error: {msg}
                    </p>
                )}
            </div>
        </main>
    );
}
