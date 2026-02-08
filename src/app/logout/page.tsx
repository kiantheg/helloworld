"use client";

import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
    supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export default function LogoutPage() {
    useEffect(() => {
        (async () => {
            if (supabase) {
                await supabase.auth.signOut();
            }
            window.location.replace("/login");
        })();
    }, []);

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
            <div className="text-slate-300 text-sm">Signing out…</div>
        </main>
    );
}
