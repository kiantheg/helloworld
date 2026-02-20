"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type CaptionRow = {
  id: string;
  content: string | null;
  image_id: string | null;
  profile_id: string;
  like_count: number | null;
  created_datetime_utc: string | null;
  images: { url: string | null } | null;
};

type VoteRow = {
  id: number;
  caption_id: string;
  profile_id: string;
  vote_value: number;
  created_datetime_utc?: string | null;
};

type ImageVariant = "stage" | "card" | "thumb";
type UndoState = {
  captionId: string;
  previousVote: 1 | -1 | 0;
};
const LOAD_BATCH_SIZE = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
const missingSupabaseError =
  "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.";

const readStoredPrefs = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("caption-studio-prefs");
    if (!raw) return null;
    return JSON.parse(raw) as {
      viewMode?: "stage" | "wall";
      sortMode?: "top" | "new";
      showShortcuts?: boolean;
      focusMode?: boolean;
    };
  } catch {
    return null;
  }
};

const buildImageAlt = (caption: CaptionRow) => {
  const text = (caption.content ?? "Caption").trim();
  if (!text) return "Image for caption";
  if (text.length <= 90) return `Image for caption: ${text}`;
  return `Image for caption: ${text.slice(0, 87)}...`;
};

const relativeTime = (value: string | null) => {
  if (!value) return "unknown";
  const diffMs = Date.now() - new Date(value).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const getCreatedTime = (caption: CaptionRow) =>
  new Date(caption.created_datetime_utc ?? 0).getTime();

const getImageGroupKey = (caption: CaptionRow) => caption.image_id ?? `caption-${caption.id}`;

const diversifyByImage = (
  rows: CaptionRow[],
  rankValue: (caption: CaptionRow) => number
) => {
  const buckets = new Map<string, CaptionRow[]>();

  rows.forEach((caption) => {
    const key = getImageGroupKey(caption);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(caption);
  });

  const sortedBuckets = Array.from(buckets.values()).map((bucket) =>
    [...bucket].sort((a, b) => rankValue(b) - rankValue(a))
  );

  sortedBuckets.sort((a, b) => rankValue(b[0]) - rankValue(a[0]));

  const mixed: CaptionRow[] = [];
  let addedInPass = true;
  while (addedInPass) {
    addedInPass = false;
    for (const bucket of sortedBuckets) {
      const next = bucket.shift();
      if (!next) continue;
      mixed.push(next);
      addedInPass = true;
    }
  }

  return mixed;
};

export default function Home() {
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(
    supabase ? null : missingSupabaseError
  );
  const [profileId, setProfileId] = useState<string | null>(null);
  const [captions, setCaptions] = useState<CaptionRow[]>([]);
  const [rankScoreByCaption, setRankScoreByCaption] = useState<Record<string, number>>({});
  const [myVotes, setMyVotes] = useState<Record<string, number>>({});
  const [submittingCaptionId, setSubmittingCaptionId] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const [viewMode, setViewMode] = useState<"stage" | "wall">(() => {
    const stored = readStoredPrefs();
    return stored?.viewMode === "wall" ? "wall" : "stage";
  });
  const [sortMode, setSortMode] = useState<"top" | "new">(() => {
    const stored = readStoredPrefs();
    return stored?.sortMode === "new" ? "new" : "top";
  });
  const [activeCaptionId, setActiveCaptionId] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState(LOAD_BATCH_SIZE);
  const [showShortcuts, setShowShortcuts] = useState(() => {
    const stored = readStoredPrefs();
    return Boolean(stored?.showShortcuts);
  });
  const [showOptions, setShowOptions] = useState(false);
  const [focusMode, setFocusMode] = useState(() => {
    const stored = readStoredPrefs();
    return Boolean(stored?.focusMode);
  });
  const [stageTransitioning, setStageTransitioning] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [reactionPulseCaptionId, setReactionPulseCaptionId] = useState<string | null>(null);
  const stageSwapTimerRef = useRef<number | null>(null);
  const stageFadeTimerRef = useRef<number | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const reactionPulseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      "caption-studio-prefs",
      JSON.stringify({ viewMode, sortMode, showShortcuts, focusMode })
    );
  }, [focusMode, showShortcuts, sortMode, viewMode]);

  useEffect(() => {
    if (!supabase) return;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        window.location.assign("/login");
        return;
      }

      setProfileId(session.user.id);

      const { data: captionData, error: captionError } = await supabase
        .from("captions")
        .select(
          "id, content, image_id, profile_id, like_count, created_datetime_utc, images(url)"
        )
        .order("created_datetime_utc", { ascending: false })
        .limit(loadedCount);

      if (captionError) {
        setError(captionError.message);
        setLoading(false);
        return;
      }

      const safeCaptions = (captionData ?? []) as CaptionRow[];
      setCaptions(safeCaptions);
      setActiveCaptionId((prev) => {
        if (prev && safeCaptions.some((caption) => caption.id === prev)) return prev;
        return safeCaptions[0]?.id ?? null;
      });

      if (safeCaptions.length === 0) {
        setLoading(false);
        return;
      }

      const captionIds = safeCaptions.map((c) => c.id);
      const { data: voteRows, error: voteError } = await supabase
        .from("caption_votes")
        .select("id, caption_id, profile_id, vote_value")
        .in("caption_id", captionIds);

      if (voteError) {
        setError(voteError.message);
        setLoading(false);
        return;
      }

      const totals: Record<string, number> = {};
      const mine: Record<string, number> = {};

      (voteRows as VoteRow[] | null)?.forEach((vote) => {
        totals[vote.caption_id] = (totals[vote.caption_id] ?? 0) + vote.vote_value;
        if (vote.profile_id === session.user.id) {
          mine[vote.caption_id] = vote.vote_value;
        }
      });

      setRankScoreByCaption(totals);
      setMyVotes(mine);
      setLoading(false);
    };

    void load();
  }, [loadedCount]);

  const sortedCaptions = useMemo(() => {
    const list = [...captions];
    if (sortMode === "new") {
      return diversifyByImage(list, (caption) => getCreatedTime(caption));
    }

    return diversifyByImage(
      list,
      (caption) => (rankScoreByCaption[caption.id] ?? 0) * 10000000000000 + getCreatedTime(caption)
    );
  }, [captions, rankScoreByCaption, sortMode]);

  const activeIndex = useMemo(() => {
    if (!activeCaptionId) return 0;
    const idx = sortedCaptions.findIndex((c) => c.id === activeCaptionId);
    return idx >= 0 ? idx : 0;
  }, [activeCaptionId, sortedCaptions]);

  const activeCaption = sortedCaptions[activeIndex] ?? null;

  const focusCaption = useCallback(
    (nextCaptionId: string) => {
      if (nextCaptionId === activeCaptionId) return;
      if (viewMode !== "stage") {
        setActiveCaptionId(nextCaptionId);
        return;
      }

      if (stageSwapTimerRef.current) window.clearTimeout(stageSwapTimerRef.current);
      if (stageFadeTimerRef.current) window.clearTimeout(stageFadeTimerRef.current);

      setStageTransitioning(true);
      stageSwapTimerRef.current = window.setTimeout(() => {
        setActiveCaptionId(nextCaptionId);
        stageFadeTimerRef.current = window.setTimeout(() => {
          setStageTransitioning(false);
        }, 170);
      }, 120);
    },
    [activeCaptionId, viewMode]
  );

  const queueCaptions = useMemo(() => {
    if (sortedCaptions.length <= 1) return [];
    const next: CaptionRow[] = [];
    for (let i = 1; i <= Math.min(4, sortedCaptions.length - 1); i += 1) {
      const idx = (activeIndex + i) % sortedCaptions.length;
      next.push(sortedCaptions[idx]);
    }
    return next;
  }, [activeIndex, sortedCaptions]);

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      if (sortedCaptions.length === 0) return;
      const nextIndex =
        (activeIndex + direction + sortedCaptions.length) % sortedCaptions.length;
      focusCaption(sortedCaptions[nextIndex].id);
    },
    [activeIndex, focusCaption, sortedCaptions]
  );

  const pickRandom = useCallback(() => {
    if (sortedCaptions.length === 0) return;
    const idx = Math.floor(Math.random() * sortedCaptions.length);
    focusCaption(sortedCaptions[idx].id);
  }, [focusCaption, sortedCaptions]);

  useEffect(() => {
    return () => {
      if (stageSwapTimerRef.current) window.clearTimeout(stageSwapTimerRef.current);
      if (stageFadeTimerRef.current) window.clearTimeout(stageFadeTimerRef.current);
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
      if (reactionPulseTimerRef.current) {
        window.clearTimeout(reactionPulseTimerRef.current);
      }
    };
  }, []);

  const submitVote = useCallback(
    async (captionId: string, voteValue: 1 | -1, advanceToNext = false) => {
      if (!supabase || !profileId) {
        window.location.assign("/login");
        return;
      }

      const shouldAdvance =
        advanceToNext && captionId === activeCaptionId && sortedCaptions.length > 1;
      const nextCaptionId = shouldAdvance
        ? sortedCaptions[(activeIndex + 1) % sortedCaptions.length].id
        : null;

      setError(null);
      setSubmittingCaptionId(captionId);

      const { data: existingRows, error: existingError } = await supabase
        .from("caption_votes")
        .select("id, vote_value, created_datetime_utc")
        .eq("caption_id", captionId)
        .eq("profile_id", profileId)
        .order("created_datetime_utc", { ascending: false })
        .limit(1);

      if (existingError) {
        setError(existingError.message);
        setSubmittingCaptionId(null);
        return;
      }

      const existingVote = (existingRows as VoteRow[] | null)?.[0] ?? null;
      const previousVote = (existingVote?.vote_value ?? 0) as 1 | -1 | 0;
      let changed = false;

      if (!existingVote) {
        const now = new Date().toISOString();
        const { error: insertError } = await supabase.from("caption_votes").insert({
          caption_id: captionId,
          profile_id: profileId,
          vote_value: voteValue,
          created_datetime_utc: now,
          modified_datetime_utc: now,
        });

        if (insertError) {
          setError(insertError.message);
          setSubmittingCaptionId(null);
          return;
        }
        changed = true;
      } else if (existingVote.vote_value !== voteValue) {
        const { error: updateError } = await supabase
          .from("caption_votes")
          .update({ vote_value: voteValue, modified_datetime_utc: new Date().toISOString() })
          .eq("id", existingVote.id);

        if (updateError) {
          setError(updateError.message);
          setSubmittingCaptionId(null);
          return;
        }
        changed = true;
      }

      setMyVotes((prev) => ({ ...prev, [captionId]: voteValue }));
      if (changed) {
        setUndoState({ captionId, previousVote });
        if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = window.setTimeout(() => {
          setUndoState(null);
        }, 5000);
        setReactionPulseCaptionId(captionId);
        if (reactionPulseTimerRef.current) {
          window.clearTimeout(reactionPulseTimerRef.current);
        }
        reactionPulseTimerRef.current = window.setTimeout(() => {
          setReactionPulseCaptionId(null);
        }, 650);
      }
      setSubmittingCaptionId(null);
      if (nextCaptionId) focusCaption(nextCaptionId);
    },
    [activeCaptionId, activeIndex, focusCaption, profileId, sortedCaptions]
  );

  const undoLastReaction = useCallback(async () => {
    if (!supabase || !profileId || !undoState) return;

    const { captionId, previousVote } = undoState;
    setUndoState(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);

    const { data: existingRows, error: existingError } = await supabase
      .from("caption_votes")
      .select("id, vote_value, created_datetime_utc")
      .eq("caption_id", captionId)
      .eq("profile_id", profileId)
      .order("created_datetime_utc", { ascending: false })
      .limit(1);

    if (existingError) {
      setError(existingError.message);
      return;
    }

    const current = (existingRows as VoteRow[] | null)?.[0] ?? null;

    if (previousVote === 0) {
      if (current) {
        const { error: deleteError } = await supabase
          .from("caption_votes")
          .delete()
          .eq("id", current.id);
        if (deleteError) {
          setError(deleteError.message);
          return;
        }
      }
      setMyVotes((prev) => {
        const next = { ...prev };
        delete next[captionId];
        return next;
      });
      return;
    }

    if (current) {
      const { error: updateError } = await supabase
        .from("caption_votes")
        .update({
          vote_value: previousVote,
          modified_datetime_utc: new Date().toISOString(),
        })
        .eq("id", current.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }
    } else {
      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from("caption_votes").insert({
        caption_id: captionId,
        profile_id: profileId,
        vote_value: previousVote,
        created_datetime_utc: now,
        modified_datetime_utc: now,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
    }

    setMyVotes((prev) => ({ ...prev, [captionId]: previousVote }));
  }, [profileId, undoState]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select"
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }

      if (viewMode !== "stage" || !activeCaption) return;

      const key = event.key.toLowerCase();
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveActive(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveActive(-1);
      } else if (key === "l") {
        event.preventDefault();
        void submitVote(activeCaption.id, 1, true);
      } else if (key === "d") {
        event.preventDefault();
        void submitVote(activeCaption.id, -1, true);
      } else if (key === "r") {
        event.preventDefault();
        pickRandom();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeCaption, moveActive, pickRandom, submitVote, viewMode]);

  const renderImagePanel = (caption: CaptionRow, variant: ImageVariant) => {
    const imageUrl = caption.images?.url;
    const hasWorkingImage = Boolean(imageUrl) && !brokenImages[caption.id];

    const sizeClass =
      variant === "stage"
        ? "h-[54vh] min-h-[320px] max-h-[640px]"
        : variant === "thumb"
          ? "h-full"
          : "h-64";

    if (hasWorkingImage) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl ?? ""}
          alt={buildImageAlt(caption)}
          loading="lazy"
          className={`w-full ${sizeClass} bg-[#050a18] object-contain transition duration-500 group-hover:scale-[1.01]`}
          onError={() => {
            setBrokenImages((prev) => ({ ...prev, [caption.id]: true }));
          }}
        />
      );
    }

    return (
      <div
        className={`flex w-full ${sizeClass} flex-col items-center justify-center gap-2 bg-[linear-gradient(145deg,#1b2338,#0b1326)] p-6 text-center`}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/25 text-slate-200">
          <span aria-hidden="true">◌</span>
        </div>
        <p className="text-sm text-slate-200">Image unavailable</p>
        <p className="text-[11px] text-slate-400">This caption still works without media.</p>
        {imageUrl && (
          <a
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-cyan-300/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-400/10"
          >
            Open image URL
          </a>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (viewMode !== "stage") return;
    const nextImageUrl = queueCaptions[0]?.images?.url;
    if (!nextImageUrl) return;
    const img = new Image();
    img.src = nextImageUrl;
  }, [queueCaptions, viewMode]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#080f22] p-8 text-slate-100">
        <p className="text-sm text-slate-300">Loading captions...</p>
      </main>
    );
  }

  const modeTitle = viewMode === "stage" ? "Stage And Queue" : "Poster Wall";
  const modeDescription =
    viewMode === "stage"
      ? "One active caption on stage. A live queue to the side. React with Like or Dislike and keep the show moving."
      : "A stylized board of caption posters. React directly here or send any card to Stage mode.";
  const accentPrimary =
    viewMode === "stage"
      ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100"
      : "border-cyan-300/40 bg-cyan-400/12 text-cyan-100";

  return (
    <main className="min-h-screen bg-[#080f22] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_7%_15%,rgba(251,191,36,0.16),transparent_36%),radial-gradient(circle_at_88%_8%,rgba(16,185,129,0.15),transparent_35%),radial-gradient(circle_at_50%_92%,rgba(56,189,248,0.16),transparent_40%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-35 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:52px_52px]" />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <header
          className={`relative z-30 mb-8 rounded-[30px] border bg-[#0f1a37]/70 p-6 backdrop-blur-xl ${
            focusMode ? "border-white/5 opacity-80" : "border-white/10"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.45em] text-emerald-200/80">
                Caption Studio
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl title-display">
                {modeTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
                {modeDescription}
              </p>
            </div>

            <div className="relative flex items-center gap-3">
              <div className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.2em] ${accentPrimary}`}>
                {sortedCaptions.length} loaded
              </div>
              <button
                onClick={() => setLoadedCount((prev) => prev + LOAD_BATCH_SIZE)}
                className="rounded-full border border-cyan-200/35 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-400/20"
              >
                Load {LOAD_BATCH_SIZE} More
              </button>
              <button
                onClick={() => setShowOptions((prev) => !prev)}
                className="rounded-full border border-white/20 bg-black/25 px-4 py-2 text-xs uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
              >
                Options
              </button>
              <button
                onClick={async () => {
                  if (!supabase) return;
                  await supabase.auth.signOut();
                  window.location.assign("/login");
                }}
                className="rounded-full border border-white/20 bg-slate-950/70 px-5 py-2.5 text-sm text-slate-100 transition hover:bg-slate-900"
              >
                Sign out
              </button>

              {showOptions && (
                <div className="absolute right-0 top-12 z-[120] w-64 rounded-2xl border border-white/15 bg-[#0a1229]/95 p-3 text-xs shadow-[0_20px_45px_rgba(2,6,23,0.55)] backdrop-blur">
                  <button
                    onClick={() => setShowShortcuts((prev) => !prev)}
                    className="mb-2 w-full rounded-xl border border-violet-200/30 px-3 py-2 text-left text-violet-100 hover:bg-violet-400/10"
                  >
                    {showShortcuts ? "Hide" : "Show"} shortcuts
                  </button>
                  <button
                    onClick={() => setFocusMode((prev) => !prev)}
                    className="mb-2 w-full rounded-xl border border-slate-200/20 px-3 py-2 text-left text-slate-200 hover:bg-white/10"
                  >
                    {focusMode ? "Disable" : "Enable"} focus mode
                  </button>
                  <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                    {sortMode === "top" ? "Top (de-clumped)" : "New (de-clumped)"}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className={`mt-5 flex flex-wrap items-center gap-3 text-xs ${focusMode ? "opacity-60" : ""}`}>
            <div className="inline-flex rounded-full border border-white/15 bg-black/20 p-1">
              <button
                onClick={() => setViewMode("stage")}
                className={`rounded-full px-4 py-1.5 ${
                  viewMode === "stage" ? "bg-emerald-300/20 text-emerald-100" : "text-slate-300"
                }`}
              >
                Stage
              </button>
              <button
                onClick={() => setViewMode("wall")}
                className={`rounded-full px-4 py-1.5 ${
                  viewMode === "wall" ? "bg-emerald-300/20 text-emerald-100" : "text-slate-300"
                }`}
              >
                Wall
              </button>
            </div>

            <div className="inline-flex rounded-full border border-white/15 bg-black/20 p-1">
              <button
                onClick={() => setSortMode("top")}
                className={`rounded-full px-4 py-1.5 ${
                  sortMode === "top" ? "bg-sky-300/20 text-sky-100" : "text-slate-300"
                }`}
              >
                Top
              </button>
              <button
                onClick={() => setSortMode("new")}
                className={`rounded-full px-4 py-1.5 ${
                  sortMode === "new" ? "bg-sky-300/20 text-sky-100" : "text-slate-300"
                }`}
              >
                New
              </button>
            </div>

            <button
              onClick={pickRandom}
              className="rounded-full border border-amber-200/35 px-4 py-2 text-amber-100 hover:bg-amber-400/10"
            >
              Surprise Me
            </button>
            <span className="rounded-full border border-white/15 bg-white/5 px-4 py-2 uppercase tracking-[0.2em] text-slate-300">
              {viewMode === "stage" ? "Stage nav: ← →" : "Wall browse"}
            </span>
          </div>
        </header>

        {error && (
          <p
            aria-live="polite"
            className="mb-5 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            Error: {error}
          </p>
        )}

        {showShortcuts && (
          <div className="mb-5 rounded-2xl border border-violet-200/25 bg-violet-500/10 p-4 text-xs text-violet-100">
            <p className="text-[0.62rem] uppercase tracking-[0.3em] text-violet-200/90">
              Shortcuts
            </p>
            <p className="mt-2">`L` like, `D` dislike, `R` random, `←/→` navigate, `?` toggle this panel.</p>
          </div>
        )}

        {undoState && (
          <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-amber-200/35 bg-[#1f1a0e]/95 px-4 py-3 text-xs text-amber-100 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur">
            <p className="uppercase tracking-[0.2em] text-amber-200/90">Reaction Saved</p>
            <button
              onClick={() => {
                void undoLastReaction();
              }}
              className="mt-2 rounded-full border border-amber-200/40 px-3 py-1 font-medium hover:bg-amber-400/10"
            >
              Undo
            </button>
          </div>
        )}

        {viewMode === "stage" && activeCaption ? (
          <section className="grid gap-5 xl:grid-cols-[220px_1fr_300px]">
            <aside className="rounded-[26px] border border-white/10 bg-[#101c3b]/78 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.35)]">
              {!focusMode && (
                <p className="text-[0.62rem] uppercase tracking-[0.3em] text-sky-200/80">
                  Reaction Panel
                </p>
              )}
              <div className={`${focusMode ? "mt-0" : "mt-4"} space-y-3`}>
                <button
                  aria-label="Like caption"
                  onClick={() => submitVote(activeCaption.id, 1, true)}
                  disabled={submittingCaptionId === activeCaption.id}
                  className={`w-full rounded-2xl border px-3 py-4 text-sm font-semibold transition duration-200 ${
                    (myVotes[activeCaption.id] ?? 0) === 1
                      ? "border-emerald-300 bg-emerald-400/25 text-emerald-100"
                      : "border-emerald-300/50 text-emerald-100 hover:bg-emerald-500/15"
                  } ${reactionPulseCaptionId === activeCaption.id ? "ring-2 ring-emerald-300/55" : ""} disabled:opacity-50`}
                >
                  Like
                </button>
                <button
                  aria-label="Dislike caption"
                  onClick={() => submitVote(activeCaption.id, -1, true)}
                  disabled={submittingCaptionId === activeCaption.id}
                  className={`w-full rounded-2xl border px-3 py-4 text-sm font-semibold transition duration-200 ${
                    (myVotes[activeCaption.id] ?? 0) === -1
                      ? "border-rose-300 bg-rose-400/25 text-rose-100"
                      : "border-rose-300/50 text-rose-100 hover:bg-rose-500/15"
                  } ${reactionPulseCaptionId === activeCaption.id ? "ring-2 ring-rose-300/50" : ""} disabled:opacity-50`}
                >
                  Dislike
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => moveActive(-1)}
                  className="rounded-xl border border-white/20 px-3 py-2 transition duration-150 hover:bg-white/10"
                >
                  Previous
                </button>
                <button
                  onClick={() => moveActive(1)}
                  className="rounded-xl border border-white/20 px-3 py-2 transition duration-150 hover:bg-white/10"
                >
                  Next
                </button>
              </div>
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-center text-[0.68rem] uppercase tracking-[0.2em] text-slate-300">
                Item {activeIndex + 1} of {sortedCaptions.length}
              </div>
            </aside>

            <article
              className={`group overflow-hidden rounded-[30px] border border-white/15 bg-[#101b38]/95 shadow-[0_30px_80px_rgba(2,6,23,0.58)] transition duration-220 ${
                stageTransitioning ? "scale-[0.992] opacity-40" : "scale-100 opacity-100"
              }`}
            >
              <div className="relative">
                {renderImagePanel(activeCaption, "stage")}
                <div className="pointer-events-none absolute inset-0 ring-1 ring-white/10" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#060b18]/90 via-[#060b18]/45 to-transparent p-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs text-slate-200">
                    <span>{relativeTime(activeCaption.created_datetime_utc)}</span>
                    {!focusMode && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                        <span>Arrow keys to navigate</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-5">
                <p className="rounded-[22px] border border-white/10 bg-[#0a1229]/75 px-5 py-4 text-[1.05rem] leading-relaxed text-slate-100">
                  {activeCaption.content ?? "No caption text."}
                </p>
                {submittingCaptionId === activeCaption.id && (
                  <p aria-live="polite" className="mt-3 text-xs text-slate-400">
                    Saving reaction...
                  </p>
                )}
              </div>
            </article>

            <aside className="rounded-[26px] border border-white/10 bg-[#101c3b]/78 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.35)]">
              {!focusMode && (
                <div className="flex items-center justify-between">
                  <p className="text-[0.62rem] uppercase tracking-[0.3em] text-amber-200/80">
                    Upcoming Queue
                  </p>
                  <span className="text-[11px] text-slate-400">tap to jump</span>
                </div>
              )}

              <div className={`relative ${focusMode ? "mt-0" : "mt-4"} h-[420px]`}>
                {queueCaptions.map((caption, index) => {
                  const tilt = [-4, 5, -3, 4][index] ?? 0;
                  return (
                    <button
                      key={`queue-${caption.id}`}
                      onClick={() => focusCaption(caption.id)}
                      className={`absolute left-0 w-full overflow-hidden rounded-2xl border bg-[#0b142d] text-left transition duration-220 ${
                        caption.id === activeCaption.id
                          ? "border-cyan-300/60 shadow-[0_0_0_1px_rgba(103,232,249,0.45)]"
                          : "border-white/15 hover:border-sky-200/50"
                      }`}
                      style={{
                        top: `${index * 82}px`,
                        transform: `rotate(${tilt}deg)`,
                        zIndex: 10 - index,
                      }}
                    >
                      <div className="grid grid-cols-[88px_1fr] gap-2 p-2">
                        <div className="h-16 overflow-hidden rounded-xl bg-slate-900">
                          {renderImagePanel(caption, "thumb")}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs text-slate-200">
                            {caption.content ?? "No caption"}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {relativeTime(caption.created_datetime_utc)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>
          </section>
        ) : (
          <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {sortedCaptions.map((caption) => {
              const myVote = myVotes[caption.id] ?? 0;
              const isSubmitting = submittingCaptionId === caption.id;

              return (
                <article
                  key={caption.id}
                  className="group flex h-[430px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#121d3c]/80 shadow-[0_18px_45px_rgba(2,6,23,0.45)] transition hover:border-cyan-200/35"
                >
                  <div className="flex items-center justify-end border-b border-white/10 bg-black/20 px-3 py-2">
                    <p className="text-[11px] text-slate-400">
                      {relativeTime(caption.created_datetime_utc)}
                    </p>
                  </div>

                  <div className="relative h-56 overflow-hidden">
                    {renderImagePanel(caption, "card")}
                  </div>

                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <p className="min-h-[76px] rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-relaxed text-slate-100">
                      {caption.content ?? "No caption text."}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => submitVote(caption.id, 1)}
                          disabled={isSubmitting}
                          className={`rounded-full border px-3 py-1.5 font-medium transition ${
                            myVote === 1
                              ? "border-emerald-300 bg-emerald-400/25 text-emerald-100"
                              : "border-emerald-300/50 text-emerald-100 hover:bg-emerald-500/15"
                          } ${reactionPulseCaptionId === caption.id ? "ring-2 ring-emerald-300/40" : ""}`}
                        >
                          Like
                        </button>
                        <button
                          onClick={() => submitVote(caption.id, -1)}
                          disabled={isSubmitting}
                          className={`rounded-full border px-3 py-1.5 font-medium transition ${
                            myVote === -1
                              ? "border-rose-300 bg-rose-400/25 text-rose-100"
                              : "border-rose-300/50 text-rose-100 hover:bg-rose-500/15"
                          } ${reactionPulseCaptionId === caption.id ? "ring-2 ring-rose-300/40" : ""}`}
                        >
                          Dislike
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          setViewMode("stage");
                          focusCaption(caption.id);
                        }}
                        className="rounded-full border border-sky-200/35 px-3 py-1.5 text-xs font-medium text-sky-100 transition hover:bg-sky-400/10"
                      >
                        Stage
                      </button>
                    </div>
                    {isSubmitting && (
                      <p aria-live="polite" className="mt-2 text-xs text-slate-400">
                        Saving reaction...
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap");

        :root {
          --ui-ease: cubic-bezier(0.2, 0.7, 0, 1);
          --ui-fast: 150ms;
          --ui-med: 220ms;
          --ui-slow: 320ms;
        }

        body {
          font-family: "Space Grotesk", "Sora", sans-serif;
          letter-spacing: 0.005em;
        }

        .title-display {
          font-family: "Fraunces", "Times New Roman", serif;
          font-weight: 650;
          letter-spacing: -0.01em;
        }

        button {
          transition-timing-function: var(--ui-ease);
        }
      `}</style>
    </main>
  );
}
