"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
    supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export default function AuthCallbackPage() {
    const [message, setMessage] = useState("Finishing sign-in…");

    useEffect(() => {
        if (!supabase) {
            setMessage("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
            return;
        }

        (async () => {
            const url = new URL(window.location.href);
            const code = url.searchParams.get("code");

            if (code) {
                const { error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) {
                    setMessage(`Sign-in failed: ${error.message}`);
                    return;
                }

                window.location.replace("/");
                return;
            }

            const hashParams = new URLSearchParams(window.location.hash.slice(1));
            const accessToken = hashParams.get("access_token");
            const refreshToken = hashParams.get("refresh_token");

            if (accessToken) {
                const { error } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken ?? "",
                });

                if (error) {
                    setMessage(`Sign-in failed: ${error.message}`);
                    return;
                }

                window.location.replace("/");
                return;
            }

            window.location.replace("/login?error=missing_code");
        })();
    }, []);

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
            <div className="text-slate-300 text-sm">{message}</div>
        </main>
    );
}
