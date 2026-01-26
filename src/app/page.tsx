"use client";

import { useEffect, useMemo, useState } from "react";

const MESSAGES = [
  "Hello World 👋",
  "Hello from Kian’s first Vercel deploy 🚀",
  "Next.js is alive ✅",
  "Ship it. Then iterate. 🔁",
  "If it compiles, it vibes 😌",
];

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [now, setNow] = useState(() => new Date());
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const message = useMemo(() => MESSAGES[idx % MESSAGES.length], [idx]);

  return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Deployed-ready • {formatTime(now)}
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
            {message}
          </h1>

          <p className="mt-4 text-base leading-relaxed text-slate-300 sm:text-lg">
            This is a tiny Next.js app deployed on Vercel. Click the button to
            rotate the headline, and refresh to see it stay fast.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
                onClick={() => setIdx((x) => x + 1)}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:opacity-90"
            >
              Change message
            </button>

            <a
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                href="https://vercel.com"
                target="_blank"
                rel="noreferrer"
            >
              Learn Vercel
            </a>

            <a
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                href="https://nextjs.org/docs"
                target="_blank"
                rel="noreferrer"
            >
              Next.js docs
            </a>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm text-slate-300">Status</div>
              <div className="mt-2 text-lg font-semibold">All systems go ✅</div>
              <p className="mt-2 text-sm text-slate-300">
                You’re running App Router + Tailwind, and your repo is connected to
                deploy.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm text-slate-300">Next step</div>
              <div className="mt-2 text-lg font-semibold">Deploy on Vercel 🚀</div>
              <p className="mt-2 text-sm text-slate-300">
                Push to GitHub, import into Vercel, turn off Deployment Protection,
                and submit the URL.
              </p>
            </div>
          </div>

          <footer className="mt-12 text-xs text-slate-400">
            Built with Next.js • {now.toDateString()}
          </footer>
        </div>
      </main>
  );
}