"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createClient } from "@supabase/supabase-js";

type CaptionRow = {
  id: string;
  content: string | null;
  image_id: string | null;
  profile_id: string;
  like_count: number | null;
  created_datetime_utc: string | null;
  images: { url: string | null } | Array<{ url: string | null }> | null;
};

type SharedImageItem = {
  id: string;
  url: string | null;
  createdAt: string | null;
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
type UploadHistoryItem = {
  imageId: string;
  imageUrl: string | null;
  createdAt: string | null;
  captions: CaptionRow[];
};

type GeneratePresignedUrlResponse = {
  presignedUrl: string;
  cdnUrl: string;
};

type RegisterImageResponse = {
  imageId: string;
};

type GenerateCaptionsResponseRow = {
  id?: string;
  content?: string | null;
};

const LOAD_BATCH_SIZE = 60;
const UPLOAD_HISTORY_LIMIT = 60;
const PIPELINE_API_BASE = "https://api.almostcrackd.ai";
const SHORTCUT_HINT_DISMISSED_KEY = "caption-studio-shortcut-hint-dismissed";
const SUPPORTED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

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

const getCaptionImageUrl = (caption: CaptionRow) => {
  if (!caption.images) return null;
  if (Array.isArray(caption.images)) return caption.images[0]?.url ?? null;
  const relationUrl = caption.images.url ?? null;
  if (relationUrl) return relationUrl;

  const record = caption as unknown as Record<string, unknown>;
  return extractImageUrl(record);
};

const hasReadyCaption = (caption: CaptionRow) => Boolean(caption.content?.trim());

const withImageUrlFallback = (
  captions: CaptionRow[],
  imageUrlById: Map<string, string | null>
): CaptionRow[] =>
  captions.map((caption) => {
    const existingUrl = getCaptionImageUrl(caption);
    if (existingUrl) return caption;
    if (!caption.image_id) return caption;
    const fallbackUrl = imageUrlById.get(caption.image_id) ?? null;
    if (!fallbackUrl) return caption;
    return { ...caption, images: { url: fallbackUrl } };
  });

const extractImageUrl = (row: Record<string, unknown> | null | undefined): string | null => {
  if (!row) return null;
  const candidates = ["url", "cdn_url", "image_url", "public_url"];
  for (const key of candidates) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
};

const relativeTime = (value: string | null) => {
  if (!value) return "unknown";
  const diffMs = Date.now() - new Date(value).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const formatNetScore = (score: number) => (score > 0 ? `+${score}` : `${score}`);

const getCreatedTime = (caption: CaptionRow) =>
  new Date(caption.created_datetime_utc ?? 0).getTime();

export default function Home() {
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(
    supabase ? null : missingSupabaseError
  );
  const [profileId, setProfileId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [captions, setCaptions] = useState<CaptionRow[]>([]);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryItem[]>([]);
  const [uploadUrlInput, setUploadUrlInput] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadIsCommonUse, setUploadIsCommonUse] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [lastGeneratedCaptions, setLastGeneratedCaptions] = useState<string[]>([]);
  const [generatedPreviewImageUrl, setGeneratedPreviewImageUrl] = useState<string | null>(null);
  const [generatedCaptionIndex, setGeneratedCaptionIndex] = useState(0);
  const [selectedHistoryImageId, setSelectedHistoryImageId] = useState<string | null>(null);
  const [sharedImages, setSharedImages] = useState<SharedImageItem[]>([]);
  const [sharedLibraryVisibleCount, setSharedLibraryVisibleCount] = useState(16);
  const [workspaceView, setWorkspaceView] = useState<"rating" | "upload">("rating");
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
  const [stageTransitioning, setStageTransitioning] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [reactionPulseCaptionId, setReactionPulseCaptionId] = useState<string | null>(null);
  const [shortcutHintDismissed, setShortcutHintDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SHORTCUT_HINT_DISMISSED_KEY) === "true";
  });
  const [ratingSearchQuery, setRatingSearchQuery] = useState("");
  const stageSwapTimerRef = useRef<number | null>(null);
  const stageFadeTimerRef = useRef<number | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const reactionPulseTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const keyboardBindingsRef = useRef<{
    activeCaption: CaptionRow | null;
    moveActive: (direction: 1 | -1) => void;
    pickRandom: () => void;
    submitVote: (captionId: string, voteValue: 1 | -1, advanceToNext?: boolean) => Promise<void>;
    undoLastReaction: () => Promise<void>;
    viewMode: "stage" | "wall";
    workspaceView: "rating" | "upload";
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      "caption-studio-prefs",
      JSON.stringify({ viewMode, sortMode, showShortcuts })
    );
  }, [showShortcuts, sortMode, viewMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      SHORTCUT_HINT_DISMISSED_KEY,
      shortcutHintDismissed ? "true" : "false"
    );
  }, [shortcutHintDismissed]);

  const loadBoardData = useCallback(
    async (userId: string) => {
      if (!supabase) return;

      const { data: captionData, error: captionError } = await supabase
        .from("captions")
        .select(
          "id, content, image_id, profile_id, like_count, created_datetime_utc, images(url)"
        )
        .order("created_datetime_utc", { ascending: false })
        .limit(loadedCount);

      if (captionError) {
        setError(captionError.message);
        return;
      }

      const baseCaptions = ((captionData ?? []) as CaptionRow[]).filter(hasReadyCaption);
      const imageIds = Array.from(
        new Set(baseCaptions.map((caption) => caption.image_id).filter(Boolean))
      ) as string[];

      const imageUrlById = new Map<string, string | null>();
      if (imageIds.length > 0) {
        const { data: imageRows, error: imageError } = await supabase
          .from("images")
          .select("*")
          .in("id", imageIds);

        if (imageError) {
          setError(imageError.message);
          return;
        }

        (imageRows ?? []).forEach((row) => {
          imageUrlById.set(row.id as string, extractImageUrl(row as Record<string, unknown>));
        });
      }

      const safeCaptions = withImageUrlFallback(baseCaptions, imageUrlById);
      setCaptions(safeCaptions);
      setActiveCaptionId((prev) => {
        if (prev && safeCaptions.some((caption) => caption.id === prev)) return prev;
        return safeCaptions[0]?.id ?? null;
      });

      if (safeCaptions.length === 0) {
        setRankScoreByCaption({});
        setMyVotes({});
        return;
      }

      const captionIds = safeCaptions.map((c) => c.id);
      const { data: voteRows, error: voteError } = await supabase
        .from("caption_votes")
        .select("id, caption_id, profile_id, vote_value")
        .in("caption_id", captionIds);

      if (voteError) {
        setError(voteError.message);
        return;
      }

      const totals: Record<string, number> = {};
      const mine: Record<string, number> = {};

      (voteRows as VoteRow[] | null)?.forEach((vote) => {
        totals[vote.caption_id] = (totals[vote.caption_id] ?? 0) + vote.vote_value;
        if (vote.profile_id === userId) {
          mine[vote.caption_id] = vote.vote_value;
        }
      });

      setRankScoreByCaption(totals);
      setMyVotes(mine);
    },
    [loadedCount]
  );

  const loadUploadHistory = useCallback(async (userId: string) => {
    if (!supabase) return;

    const { data: imageData, error: imageError } = await supabase
      .from("images")
      .select("*")
      .eq("profile_id", userId)
      .order("created_datetime_utc", { ascending: false })
      .limit(UPLOAD_HISTORY_LIMIT);

    if (imageError) {
      setUploadError(imageError.message);
      return;
    }

    const imageRows = ((imageData ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      url: extractImageUrl(row),
      created_datetime_utc: (row.created_datetime_utc as string | null) ?? null,
    }));
    if (imageRows.length === 0) {
      setUploadHistory([]);
      setSelectedHistoryImageId(null);
      return;
    }

    const imageIds = imageRows.map((row) => row.id);
    const { data: captionData, error: captionError } = await supabase
      .from("captions")
      .select("id, content, image_id, profile_id, like_count, created_datetime_utc, images(url)")
      .in("image_id", imageIds)
      .order("created_datetime_utc", { ascending: false });

    if (captionError) {
      setUploadError(captionError.message);
      return;
    }

    const byImageId = new Map<string, CaptionRow[]>();
    const imageUrlById = new Map<string, string | null>();
    imageRows.forEach((row) => {
      imageUrlById.set(row.id, row.url ?? null);
    });

    withImageUrlFallback((captionData ?? []) as CaptionRow[], imageUrlById).forEach((row) => {
      if (!row.image_id) return;
      if (!byImageId.has(row.image_id)) byImageId.set(row.image_id, []);
      byImageId.get(row.image_id)!.push(row);
    });

    const nextHistory = imageRows.map((row) => ({
      imageId: row.id,
      imageUrl: row.url,
      createdAt: row.created_datetime_utc,
      captions: (byImageId.get(row.id) ?? []).filter(hasReadyCaption),
    }));
    setUploadHistory(nextHistory);
    setSelectedHistoryImageId((prev) => prev ?? nextHistory[0]?.imageId ?? null);
  }, []);

  const loadSharedImageLibrary = useCallback(async () => {
    if (!supabase) return;

    const { data, error: sharedError } = await supabase
      .from("images")
      .select("*")
      .eq("is_common_use", true)
      .order("created_datetime_utc", { ascending: false })
      .limit(80);

    if (sharedError) {
      setUploadError(sharedError.message);
      return;
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    setSharedImages(
      rows
        .map((row) => ({
          id: String(row.id ?? ""),
          url: extractImageUrl(row),
          createdAt: (row.created_datetime_utc as string | null) ?? null,
        }))
        .filter((row) => Boolean(row.id) && Boolean(row.url))
    );
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      setUploadError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        window.location.assign("/login");
        return;
      }

      setProfileId(session.user.id);
      setAccessToken(session.access_token ?? null);

      await loadBoardData(session.user.id);
      await loadUploadHistory(session.user.id);
      await loadSharedImageLibrary();
      setLoading(false);
    };

    void load();
  }, [loadBoardData, loadSharedImageLibrary, loadUploadHistory]);

  const generateCaptionsForImage = useCallback(
    async (imageId: string, token: string) => {
      const response = await fetch(`${PIPELINE_API_BASE}/pipeline/generate-captions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageId }),
      });
      if (!response.ok) {
        throw new Error(`Caption generation failed (${response.status})`);
      }

      const generated = (await response.json()) as GenerateCaptionsResponseRow[];
      const texts = generated
        .map((row) => row.content?.trim() ?? "")
        .filter((value) => Boolean(value));
      setLastGeneratedCaptions(texts);
    },
    []
  );

  useEffect(() => {
    if (lastGeneratedCaptions.length === 0) {
      setGeneratedCaptionIndex(0);
      return;
    }
    setGeneratedCaptionIndex((prev) =>
      Math.min(prev, Math.max(0, lastGeneratedCaptions.length - 1))
    );
  }, [lastGeneratedCaptions]);

  const registerAndGenerateFromUrl = useCallback(
    async (imageUrl: string) => {
      if (!supabase || !accessToken || !profileId) {
        window.location.assign("/login");
        return;
      }

      setUploadBusy(true);
      setUploadError(null);
      setUploadStatus("Registering image URL...");
      setGeneratedPreviewImageUrl(imageUrl);
      setLastGeneratedCaptions([]);
      setGeneratedCaptionIndex(0);

      try {
        const registerResponse = await fetch(`${PIPELINE_API_BASE}/pipeline/upload-image-from-url`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ imageUrl, isCommonUse: uploadIsCommonUse }),
        });

        if (!registerResponse.ok) {
          throw new Error(`Image registration failed (${registerResponse.status})`);
        }

        const registerBody = (await registerResponse.json()) as RegisterImageResponse;
        setUploadStatus("Generating captions...");
        await generateCaptionsForImage(registerBody.imageId, accessToken);

        setUploadStatus("Refreshing board...");
        await loadBoardData(profileId);
        await loadUploadHistory(profileId);
        await loadSharedImageLibrary();
        setUploadStatus("Done");
      } catch (uploadErr) {
        setUploadError(uploadErr instanceof Error ? uploadErr.message : "Upload failed.");
      } finally {
        setUploadBusy(false);
      }
    },
    [
      accessToken,
      generateCaptionsForImage,
      loadBoardData,
      loadSharedImageLibrary,
      loadUploadHistory,
      profileId,
      uploadIsCommonUse,
    ]
  );

  const uploadFileAndGenerate = useCallback(
    async (file: File) => {
      if (!accessToken) {
        window.location.assign("/login");
        return;
      }

      const normalizedType = file.type.toLowerCase();
      if (!SUPPORTED_UPLOAD_TYPES.has(normalizedType)) {
        setUploadError(`Unsupported file type: ${file.type || "unknown"}`);
        return;
      }

      setUploadBusy(true);
      setUploadError(null);

      try {
        setUploadStatus("Getting upload URL...");
        const presignedResponse = await fetch(
          `${PIPELINE_API_BASE}/pipeline/generate-presigned-url`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ contentType: normalizedType }),
          }
        );

        if (!presignedResponse.ok) {
          throw new Error(`Unable to create upload URL (${presignedResponse.status})`);
        }

        const presignedBody = (await presignedResponse.json()) as GeneratePresignedUrlResponse;

        setUploadStatus("Uploading image bytes...");
        const putResponse = await fetch(presignedBody.presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": normalizedType },
          body: file,
        });
        if (!putResponse.ok) {
          throw new Error(`File upload failed (${putResponse.status})`);
        }

        await registerAndGenerateFromUrl(presignedBody.cdnUrl);
      } catch (uploadErr) {
        setUploadError(uploadErr instanceof Error ? uploadErr.message : "File upload failed.");
        setUploadBusy(false);
      }
    },
    [accessToken, registerAndGenerateFromUrl]
  );

  const generateFromSharedImage = useCallback(
    async (imageId: string) => {
      if (!accessToken || !profileId) {
        window.location.assign("/login");
        return;
      }

      setUploadBusy(true);
      setUploadError(null);
      setUploadStatus("Generating captions from library image...");
      const preview = sharedImages.find((image) => image.id === imageId)?.url ?? null;
      setGeneratedPreviewImageUrl(preview);
      setLastGeneratedCaptions([]);
      setGeneratedCaptionIndex(0);
      try {
        await generateCaptionsForImage(imageId, accessToken);
        await loadBoardData(profileId);
        await loadUploadHistory(profileId);
        await loadSharedImageLibrary();
        setUploadStatus("Done");
      } catch (uploadErr) {
        setUploadError(
          uploadErr instanceof Error ? uploadErr.message : "Unable to generate captions."
        );
      } finally {
        setUploadBusy(false);
      }
    },
    [
      accessToken,
      generateCaptionsForImage,
      loadBoardData,
      loadSharedImageLibrary,
      loadUploadHistory,
      profileId,
      sharedImages,
    ]
  );

  const onUrlSubmit = useCallback(async () => {
    const value = uploadUrlInput.trim();
    if (!value) return;

    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        setUploadError("Image URL must start with http:// or https://");
        return;
      }
    } catch {
      setUploadError("Enter a valid image URL.");
      return;
    }

    await registerAndGenerateFromUrl(value);
    setUploadUrlInput("");
  }, [registerAndGenerateFromUrl, uploadUrlInput]);

  const onFileSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setGeneratedPreviewImageUrl(URL.createObjectURL(file));
      setUploadStatus(`Selected ${file.name}. Uploading...`);
      setLastGeneratedCaptions([]);
      setGeneratedCaptionIndex(0);
      await uploadFileAndGenerate(file);
      event.target.value = "";
    },
    [uploadFileAndGenerate]
  );

  const onDropAreaDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  }, []);

  const onDropAreaDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  }, []);

  const onDropAreaDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      setGeneratedPreviewImageUrl(URL.createObjectURL(file));
      setUploadStatus(`Selected ${file.name}. Uploading...`);
      setLastGeneratedCaptions([]);
      setGeneratedCaptionIndex(0);
      await uploadFileAndGenerate(file);
    },
    [uploadFileAndGenerate]
  );

  const sortedCaptions = useMemo(() => {
    const list = [...captions];
    if (sortMode === "new") {
      return list.sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
    }

    return list.sort((a, b) => {
      const scoreDiff = (rankScoreByCaption[b.id] ?? 0) - (rankScoreByCaption[a.id] ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return getCreatedTime(b) - getCreatedTime(a);
    });
  }, [captions, rankScoreByCaption, sortMode]);

  const filteredCaptions = useMemo(() => {
    const query = ratingSearchQuery.trim().toLowerCase();
    if (!query) return sortedCaptions;
    return sortedCaptions.filter((caption) => {
      const content = caption.content?.toLowerCase() ?? "";
      const createdAt = caption.created_datetime_utc?.toLowerCase() ?? "";
      return content.includes(query) || createdAt.includes(query);
    });
  }, [ratingSearchQuery, sortedCaptions]);

  const activeIndex = useMemo(() => {
    if (!activeCaptionId) return 0;
    const idx = filteredCaptions.findIndex((c) => c.id === activeCaptionId);
    return idx >= 0 ? idx : 0;
  }, [activeCaptionId, filteredCaptions]);

  const activeCaption = filteredCaptions[activeIndex] ?? null;

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
    if (filteredCaptions.length <= 1) return [];
    const next: CaptionRow[] = [];
    for (let i = 1; i <= Math.min(4, filteredCaptions.length - 1); i += 1) {
      const idx = (activeIndex + i) % filteredCaptions.length;
      next.push(filteredCaptions[idx]);
    }
    return next;
  }, [activeIndex, filteredCaptions]);

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      if (filteredCaptions.length === 0) return;
      const nextIndex =
        (activeIndex + direction + filteredCaptions.length) % filteredCaptions.length;
      focusCaption(filteredCaptions[nextIndex].id);
    },
    [activeIndex, filteredCaptions, focusCaption]
  );

  const pickRandom = useCallback(() => {
    if (filteredCaptions.length === 0) return;
    const idx = Math.floor(Math.random() * filteredCaptions.length);
    focusCaption(filteredCaptions[idx].id);
  }, [filteredCaptions, focusCaption]);

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
        advanceToNext && captionId === activeCaptionId && filteredCaptions.length > 1;
      const nextCaptionId = shouldAdvance
        ? filteredCaptions[(activeIndex + 1) % filteredCaptions.length].id
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
        const { error: insertError } = await supabase.from("caption_votes").insert({
          caption_id: captionId,
          profile_id: profileId,
          vote_value: voteValue,
          created_by_user_id: profileId,
          modified_by_user_id: profileId,
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
          .update({ vote_value: voteValue, modified_by_user_id: profileId })
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
    [activeCaptionId, activeIndex, filteredCaptions, focusCaption, profileId]
  );

  useEffect(() => {
    if (filteredCaptions.length === 0) {
      setActiveCaptionId(null);
      return;
    }

    setActiveCaptionId((prev) => {
      if (prev && filteredCaptions.some((caption) => caption.id === prev)) return prev;
      return filteredCaptions[0]?.id ?? null;
    });
  }, [filteredCaptions]);

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
          modified_by_user_id: profileId,
        })
        .eq("id", current.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("caption_votes").insert({
        caption_id: captionId,
        profile_id: profileId,
        vote_value: previousVote,
        created_by_user_id: profileId,
        modified_by_user_id: profileId,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
    }

    setMyVotes((prev) => ({ ...prev, [captionId]: previousVote }));
  }, [profileId, undoState]);

  useEffect(() => {
    keyboardBindingsRef.current = {
      activeCaption,
      moveActive,
      pickRandom,
      submitVote,
      undoLastReaction,
      viewMode,
      workspaceView,
    };
  }, [activeCaption, moveActive, pickRandom, submitVote, undoLastReaction, viewMode, workspaceView]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select"
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const bindings = keyboardBindingsRef.current;
      if (!bindings) return;

      if (isTypingTarget(event.target)) return;
      if (bindings.workspaceView !== "rating") return;
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }
      if (event.key.toLowerCase() === "u") {
        event.preventDefault();
        void bindings.undoLastReaction();
        return;
      }

      if (bindings.viewMode !== "stage" || !bindings.activeCaption) return;

      const key = event.key.toLowerCase();
      if (event.key === "ArrowUp") {
        event.preventDefault();
        void bindings.submitVote(bindings.activeCaption.id, 1, true);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        void bindings.submitVote(bindings.activeCaption.id, -1, true);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        bindings.moveActive(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        bindings.moveActive(-1);
      } else if (key === "r") {
        event.preventDefault();
        bindings.pickRandom();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const renderImagePanel = (caption: CaptionRow, variant: ImageVariant) => {
    const imageUrl = getCaptionImageUrl(caption);
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
    const nextImageUrl = queueCaptions[0] ? getCaptionImageUrl(queueCaptions[0]) : null;
    if (!nextImageUrl) return;
    const img = new Image();
    img.src = nextImageUrl;
  }, [queueCaptions, viewMode]);

  const selectedUploadHistory =
    uploadHistory.find((item) => item.imageId === selectedHistoryImageId) ?? uploadHistory[0] ?? null;

  useEffect(() => {
    if (!selectedUploadHistory) return;

    setGeneratedPreviewImageUrl(selectedUploadHistory.imageUrl ?? null);
    setLastGeneratedCaptions(
      selectedUploadHistory.captions
        .map((caption) => caption.content?.trim() ?? "")
        .filter((caption): caption is string => Boolean(caption))
    );
    setGeneratedCaptionIndex(0);
    setUploadStatus(null);
  }, [selectedUploadHistory]);

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
      ? "Review one caption at a time, keep reactions obvious, and jump ahead from the next-up list."
      : "Browse the board, react directly on each card, or open any post in stage view.";
  const accentPrimary =
    viewMode === "stage"
      ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100"
      : "border-cyan-300/40 bg-cyan-400/12 text-cyan-100";
  const generatedCaptionText =
    lastGeneratedCaptions[generatedCaptionIndex] ??
    lastGeneratedCaptions[0] ??
    "Generate captions to preview in meme format.";
  const activeVote = activeCaption ? myVotes[activeCaption.id] ?? 0 : 0;
  const activeScore = activeCaption ? rankScoreByCaption[activeCaption.id] ?? 0 : 0;
  const filteredCountLabel =
    filteredCaptions.length === sortedCaptions.length
      ? `${sortedCaptions.length} ready`
      : `${filteredCaptions.length}/${sortedCaptions.length} ready`;

  return (
    <main className="lux-root min-h-screen bg-[#080f22] text-slate-100">
      <div className="lux-aurora pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_7%_15%,rgba(251,191,36,0.16),transparent_36%),radial-gradient(circle_at_88%_8%,rgba(16,185,129,0.15),transparent_35%),radial-gradient(circle_at_50%_92%,rgba(56,189,248,0.16),transparent_40%)]" />
      <div className="lux-grid pointer-events-none fixed inset-0 opacity-35 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:52px_52px]" />
      <div className="lux-noise pointer-events-none fixed inset-0" />
      <div className="lux-orb lux-orb-a pointer-events-none fixed -top-10 -left-10 h-64 w-64 rounded-full" />
      <div className="lux-orb lux-orb-b pointer-events-none fixed top-20 right-0 h-72 w-72 rounded-full" />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <header
          className="lux-panel lux-float-in relative z-30 mb-8 rounded-[30px] border border-white/10 bg-[#0f1a37]/70 p-6 backdrop-blur-xl"
        >
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
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

            <div className="flex flex-wrap items-center justify-end gap-2 xl:max-w-[520px]">
              <div className="flex flex-wrap gap-2">
                <div
                  className={`rounded-2xl border px-4 py-3 text-center text-sm font-medium ${accentPrimary}`}
                >
                  {filteredCountLabel}
                </div>
                <button
                  onClick={() => setLoadedCount((prev) => prev + LOAD_BATCH_SIZE)}
                  className="rounded-2xl border border-cyan-200/35 bg-cyan-400/10 px-4 py-3 text-center text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
                  title={`Load ${LOAD_BATCH_SIZE} more captions`}
                >
                  Load More
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowShortcuts((prev) => !prev)}
                  className="rounded-2xl border border-white/20 bg-black/25 px-4 py-3 text-center text-sm font-medium text-slate-200 transition hover:bg-white/10"
                  title="Show or hide shortcuts"
                >
                  {showShortcuts ? "Hide Shortcuts" : "Show Shortcuts"}
                </button>
                <button
                  onClick={async () => {
                    if (!supabase) return;
                    await supabase.auth.signOut();
                    window.location.assign("/login");
                  }}
                  className="rounded-2xl border border-white/20 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 transition hover:bg-slate-900"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-white/15 bg-black/20 p-1">
              <button
                onClick={() => setWorkspaceView("rating")}
                className={`lux-chip rounded-full px-4 py-1.5 ${
                  workspaceView === "rating"
                    ? "lux-chip-active bg-cyan-300/20 text-cyan-100"
                    : "text-slate-300"
                }`}
              >
                Rating
              </button>
              <button
                onClick={() => setWorkspaceView("upload")}
                className={`lux-chip rounded-full px-4 py-1.5 ${
                  workspaceView === "upload"
                    ? "lux-chip-active bg-cyan-300/20 text-cyan-100"
                    : "text-slate-300"
                }`}
              >
                Upload
              </button>
            </div>

            {workspaceView === "rating" && (
              <div className="inline-flex rounded-full border border-white/15 bg-black/20 p-1">
                <button
                  onClick={() => setViewMode("stage")}
                  className={`lux-chip rounded-full px-4 py-1.5 ${
                    viewMode === "stage"
                      ? "lux-chip-active bg-emerald-300/20 text-emerald-100"
                      : "text-slate-300"
                  }`}
                >
                  Stage
                </button>
                <button
                  onClick={() => setViewMode("wall")}
                  className={`lux-chip rounded-full px-4 py-1.5 ${
                    viewMode === "wall"
                      ? "lux-chip-active bg-emerald-300/20 text-emerald-100"
                      : "text-slate-300"
                  }`}
                >
                  Wall
                </button>
              </div>
            )}

            {workspaceView === "rating" && (
              <div className="inline-flex rounded-full border border-white/15 bg-black/20 p-1">
                <button
                  onClick={() => setSortMode("top")}
                  className={`lux-chip rounded-full px-4 py-1.5 ${
                    sortMode === "top"
                      ? "lux-chip-active bg-sky-300/20 text-sky-100"
                      : "text-slate-300"
                  }`}
                >
                  Top
                </button>
                <button
                  onClick={() => setSortMode("new")}
                  className={`lux-chip rounded-full px-4 py-1.5 ${
                    sortMode === "new"
                      ? "lux-chip-active bg-sky-300/20 text-sky-100"
                      : "text-slate-300"
                  }`}
                >
                  New
                </button>
              </div>
            )}

            <button
              onClick={pickRandom}
              disabled={workspaceView !== "rating"}
              className="lux-glow-btn rounded-full border border-amber-200/35 px-4 py-2 text-amber-100 hover:bg-amber-400/10"
              title="Jump to a random caption"
            >
              Surprise Me
            </button>
            </div>

            {workspaceView === "rating" && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-black/20 px-3 py-2.5 text-slate-300">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Filter</span>
                  <input
                    value={ratingSearchQuery}
                    onChange={(event) => setRatingSearchQuery(event.target.value)}
                    placeholder="Search captions"
                    className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
                <span className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 uppercase tracking-[0.16em] text-slate-300">
                  {viewMode === "stage" ? "Stage: Left/right browse, up/down react" : "Wall: Click a card to open stage"}
                </span>
              </div>
            )}
          </div>
        </header>

        {workspaceView === "upload" && (
          <section className="lux-float-in relative mb-6 grid gap-5 rounded-[28px] bg-[#0b1430]/70 p-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <article className="lux-card min-w-0 rounded-[24px] border border-white/10 bg-[#0f1935]/75 p-5 shadow-[0_18px_42px_rgba(2,6,23,0.4)]">
            <p className="text-[0.62rem] uppercase tracking-[0.3em] text-cyan-200/80">
              Upload Image
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Upload from your computer, drop a file here, or paste an image link. The preview updates immediately so you can confirm the upload started.
            </p>
            <label className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={uploadIsCommonUse}
                onChange={(event) => setUploadIsCommonUse(event.target.checked)}
                className="h-4 w-4 accent-emerald-400"
              />
              Make this image available to everyone
            </label>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
              onChange={(event) => {
                void onFileSelected(event);
              }}
              className="hidden"
            />

            <div
              onDragOver={onDropAreaDragOver}
              onDragLeave={onDropAreaDragLeave}
              onDrop={(event) => {
                void onDropAreaDrop(event);
              }}
              className={`mt-4 rounded-2xl border border-dashed p-5 text-center transition ${
                dragActive
                  ? "border-cyan-300/70 bg-cyan-400/10"
                  : "border-white/20 bg-[#0a1229]/60"
              }`}
            >
              <p className="text-sm text-slate-200">Drag and drop image file here</p>
              <p className="mt-1 text-xs text-slate-400">PNG, JPG, WEBP, GIF, or HEIC</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadBusy}
                className="mt-3 rounded-full border border-cyan-200/40 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
              >
                Choose File
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={uploadUrlInput}
                onChange={(event) => setUploadUrlInput(event.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
              />
              <button
                onClick={() => {
                  void onUrlSubmit();
                }}
                disabled={uploadBusy}
                className="rounded-xl border border-sky-200/35 px-4 py-2 text-xs uppercase tracking-[0.16em] text-sky-100 hover:bg-sky-400/10 disabled:opacity-50"
              >
                Submit URL
              </button>
            </div>

            {uploadStatus && (
              <p className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">Status: {uploadStatus}</p>
            )}
            {uploadError && (
              <p className="mt-3 rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                Upload error: {uploadError}
              </p>
            )}
            {lastGeneratedCaptions.length > 0 && (
              <div className="mt-3 rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                <p className="uppercase tracking-[0.18em] text-emerald-200/90">Latest Captions</p>
                <div className="mt-2 space-y-1">
                  {lastGeneratedCaptions.slice(0, 3).map((line, index) => (
                    <p key={`latest-generated-${line}-${index}`} className="text-emerald-100/95">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[0.62rem] uppercase tracking-[0.2em] text-cyan-200/90">
                  Meme Preview Browser
                </p>
                <span className="text-[11px] text-slate-400">
                  {lastGeneratedCaptions.length > 0
                    ? `${generatedCaptionIndex + 1}/${lastGeneratedCaptions.length}`
                    : "0/0"}
                </span>
              </div>

              {generatedPreviewImageUrl ? (
                <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#050a18]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={generatedPreviewImageUrl}
                    alt="Generated meme preview"
                    className="h-80 w-full object-contain"
                    loading="lazy"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
                    <p className="meme-text text-center">{generatedCaptionText}</p>
                  </div>
                </div>
              ) : (
                <div className="flex h-80 items-center justify-center rounded-lg border border-white/10 bg-[#050a18] text-xs text-slate-400">
                  Upload or select an image to start the preview.
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() =>
                    setGeneratedCaptionIndex((prev) =>
                      lastGeneratedCaptions.length > 0
                        ? (prev - 1 + lastGeneratedCaptions.length) % lastGeneratedCaptions.length
                        : 0
                    )
                  }
                  disabled={lastGeneratedCaptions.length === 0}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setGeneratedCaptionIndex((prev) =>
                      lastGeneratedCaptions.length > 0
                        ? (prev + 1) % lastGeneratedCaptions.length
                        : 0
                    )
                  }
                  disabled={lastGeneratedCaptions.length === 0}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
                >
                  Next
                </button>
                <p className="truncate text-xs text-slate-300">{generatedCaptionText}</p>
              </div>
            </div>
          </article>

          <article className="lux-card min-w-0 rounded-[24px] border border-white/10 bg-[#0f1935]/75 p-5 shadow-[0_18px_42px_rgba(2,6,23,0.4)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.62rem] uppercase tracking-[0.3em] text-amber-200/80">
                Your Upload History
              </p>
              <span className="text-[11px] text-slate-400">{uploadHistory.length} images</span>
            </div>
            <div className="mt-4 max-h-[220px] space-y-3 overflow-auto pr-1">
              {uploadHistory.length === 0 && (
                <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
                  No uploads yet.
                </p>
              )}
              {uploadHistory.map((item) => (
                <button
                  key={`upload-history-${item.imageId}`}
                  onClick={() => setSelectedHistoryImageId(item.imageId)}
                  className={`w-full rounded-xl border bg-black/20 p-3 text-left ${
                    selectedUploadHistory?.imageId === item.imageId
                      ? "border-cyan-300/55"
                      : "border-white/10"
                  }`}
                >
                  <div className="grid grid-cols-[96px_1fr] gap-3 sm:grid-cols-[120px_1fr]">
                    <div className="h-24 overflow-hidden rounded-lg bg-[#050a18] sm:h-28">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt="Uploaded source"
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-500">
                          no image
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-slate-400">
                        {relativeTime(item.createdAt)}
                      </p>
                      <p className="mt-1 text-xs text-slate-200">
                        {item.captions.length} caption{item.captions.length === 1 ? "" : "s"}
                      </p>
                      <p className="mt-2 max-h-14 overflow-hidden rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200">
                        {item.captions[0]?.content ?? "Caption not generated yet."}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              {selectedUploadHistory ? (
                <>
                  <p className="text-[0.62rem] uppercase tracking-[0.2em] text-cyan-200/85">
                    Captions For Selected Image
                  </p>
                  {selectedUploadHistory.captions.length > 0 ? (
                    <div className="mt-2 max-h-[160px] space-y-2 overflow-auto pr-1">
                      {selectedUploadHistory.captions.map((caption) => (
                        <p
                          key={`selected-history-caption-${caption.id}`}
                          className="rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-200"
                        >
                          {caption.content}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-amber-200/90">Caption not generated yet.</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-300">Select an uploaded image to view captions.</p>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[0.62rem] uppercase tracking-[0.2em] text-emerald-200/85">
                Shared Image Library
              </p>
              {sharedImages.length > 0 ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {sharedImages.slice(0, sharedLibraryVisibleCount).map((image) => (
                      <button
                        key={`shared-image-${image.id}`}
                        onClick={() => {
                          void generateFromSharedImage(image.id);
                        }}
                        disabled={uploadBusy}
                        className="overflow-hidden rounded-lg border border-white/10 bg-[#0a1229] text-left hover:border-emerald-300/45 disabled:opacity-50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url ?? ""}
                          alt="Shared image"
                          className="h-24 w-full object-contain bg-[#050a18]"
                          loading="lazy"
                        />
                        <p className="px-2 py-1.5 text-[10px] text-slate-300">
                          {relativeTime(image.createdAt)}
                        </p>
                      </button>
                    ))}
                  </div>
                  {sharedLibraryVisibleCount < sharedImages.length && (
                    <button
                      onClick={() => setSharedLibraryVisibleCount((prev) => prev + 16)}
                      className="mt-3 w-full rounded-lg border border-emerald-300/35 bg-emerald-500/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-emerald-100 hover:bg-emerald-500/20"
                    >
                      Load 16 More Shared Images
                    </button>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-300">
                  No shared images available or you do not have permission to read them yet.
                </p>
              )}
            </div>
          </article>
          </section>
        )}

        {workspaceView === "rating" && error && (
          <p
            aria-live="polite"
            className="mb-5 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            Error: {error}
          </p>
        )}

        {workspaceView === "rating" && showShortcuts && (
          <div className="mb-5 rounded-2xl border border-violet-200/25 bg-violet-500/10 p-4 text-xs text-violet-100">
            <p className="text-[0.62rem] uppercase tracking-[0.3em] text-violet-200/90">
              Shortcuts
            </p>
            <p className="mt-2">`↑/↓` react, `←/→` browse, `R` random, `?` toggle help.</p>
          </div>
        )}

        {workspaceView === "rating" && !shortcutHintDismissed && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-cyan-200/25 bg-cyan-400/10 p-4 text-sm text-cyan-50 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.3em] text-cyan-200/90">Quick keys</p>
              <p className="mt-1 text-cyan-50/90">`↑` Like, `↓` Dislike, `←/→` Browse, `R` Random, `?` Help.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowShortcuts(true)}
                className="rounded-full border border-cyan-200/40 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-300/10"
              >
                Show help
              </button>
              <button
                onClick={() => setShortcutHintDismissed(true)}
                className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {workspaceView === "rating" && undoState && (
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

        {workspaceView === "rating" && (viewMode === "stage" && activeCaption ? (
          <section className="lux-float-in grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-5">
            <aside className="lux-card rounded-[26px] border border-white/10 bg-[#101c3b]/78 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.35)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[0.62rem] uppercase tracking-[0.3em] text-sky-200/80">
                  Current Caption
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                      sortMode === "top"
                        ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                        : "border-white/10 bg-black/20 text-slate-300"
                    }`}
                  >
                    Score {formatNetScore(activeScore)}
                  </div>
                  <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                    Item {activeIndex + 1} of {filteredCaptions.length}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <button
                  aria-label="Like caption"
                  onClick={() => submitVote(activeCaption.id, 1, true)}
                  disabled={submittingCaptionId === activeCaption.id}
                  title="Like this caption and move to the next one"
                  className={`w-full rounded-2xl border px-3 py-4 text-left text-sm font-semibold transition duration-200 ${
                    (myVotes[activeCaption.id] ?? 0) === 1
                      ? "border-emerald-300 bg-emerald-400/25 text-emerald-100"
                      : "border-emerald-300/50 text-emerald-100 hover:bg-emerald-500/15"
                  } ${reactionPulseCaptionId === activeCaption.id ? "ring-2 ring-emerald-300/55" : ""} disabled:opacity-50`}
                >
                  <span className="block">Like</span>
                  <span className="mt-1 block text-xs font-normal text-emerald-100/75">
                    Save positive vote, then continue
                  </span>
                </button>
                <button
                  aria-label="Dislike caption"
                  onClick={() => submitVote(activeCaption.id, -1, true)}
                  disabled={submittingCaptionId === activeCaption.id}
                  title="Dislike this caption and move to the next one"
                  className={`w-full rounded-2xl border px-3 py-4 text-left text-sm font-semibold transition duration-200 ${
                    (myVotes[activeCaption.id] ?? 0) === -1
                      ? "border-rose-300 bg-rose-400/25 text-rose-100"
                      : "border-rose-300/50 text-rose-100 hover:bg-rose-500/15"
                  } ${reactionPulseCaptionId === activeCaption.id ? "ring-2 ring-rose-300/50" : ""} disabled:opacity-50`}
                >
                  <span className="block">Dislike</span>
                  <span className="mt-1 block text-xs font-normal text-rose-100/75">
                    Save negative vote, then continue
                  </span>
                </button>
                <div className="grid gap-2 text-xs">
                  <button
                    onClick={() => moveActive(-1)}
                    title="Go back to the previous caption"
                    className="rounded-xl border border-white/20 px-3 py-2 transition duration-150 hover:bg-white/10"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => moveActive(1)}
                    title="Skip to the next caption without voting"
                    className="rounded-xl border border-white/20 px-3 py-2 transition duration-150 hover:bg-white/10"
                  >
                    Skip
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  {activeVote === 1 ? "You liked this caption" : activeVote === -1 ? "You disliked this caption" : "No reaction saved yet"}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  `←/→` browse · `↑/↓` react
                </span>
              </div>
            </aside>

            <article
              className={`lux-card group overflow-hidden rounded-[30px] border border-white/15 bg-[#101b38]/95 shadow-[0_30px_80px_rgba(2,6,23,0.58)] transition duration-220 ${
                stageTransitioning ? "scale-[0.992] opacity-40" : "scale-100 opacity-100"
              }`}
            >
              <div className="relative">
                {renderImagePanel(activeCaption, "stage")}
                <div className="pointer-events-none absolute inset-0 ring-1 ring-white/10" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#060b18]/90 via-[#060b18]/45 to-transparent p-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs text-slate-200">
                    <span>{relativeTime(activeCaption.created_datetime_utc)}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>Left/right browse, up/down react</span>
                  </div>
                </div>
              </div>

              <div className="p-5">
                <p className="rounded-[22px] border border-white/10 bg-[#0a1229]/75 px-5 py-4 text-[1.05rem] leading-relaxed text-slate-100">
                  {activeCaption.content ?? "No caption text."}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-slate-300">
                    Content
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1.5 ${
                      sortMode === "top"
                        ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                        : "border-white/10 bg-black/20 text-slate-300"
                    }`}
                  >
                    Net score {formatNetScore(activeScore)}
                  </span>
                  <span className="rounded-full border border-cyan-200/20 bg-cyan-400/10 px-3 py-1.5 text-cyan-100">
                    Reactions apply to this image + caption pair
                  </span>
                </div>
                {submittingCaptionId === activeCaption.id && (
                  <p aria-live="polite" className="mt-3 text-xs text-slate-400">
                    Saving reaction...
                  </p>
                )}
              </div>
            </article>
            </div>

            <aside className="lux-card rounded-[26px] border border-white/10 bg-[#101c3b]/78 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.35)]">
              <div className="flex items-center justify-between">
                <p className="text-[0.62rem] uppercase tracking-[0.3em] text-amber-200/80">
                  Next Up
                </p>
                <span className="text-[11px] text-slate-400">click to jump</span>
              </div>

              <div className="mt-4 space-y-3">
                {queueCaptions.map((caption, index) => {
                  return (
                    <button
                      key={`queue-${caption.id}`}
                      onClick={() => focusCaption(caption.id)}
                      title={`Jump to upcoming caption ${index + 1}`}
                      className={`lux-float-in w-full overflow-hidden rounded-2xl border bg-[#0b142d] text-left transition duration-220 ${
                        caption.id === activeCaption.id
                          ? "border-cyan-300/60 shadow-[0_0_0_1px_rgba(103,232,249,0.45)]"
                          : "border-white/15 hover:border-sky-200/50"
                      }`}
                      style={{
                        animationDelay: `${index * 60}ms`,
                      }}
                    >
                      <div className="grid grid-cols-[88px_1fr] gap-2 p-2">
                        <div className="h-16 overflow-hidden rounded-xl bg-slate-900">
                          {renderImagePanel(caption, "thumb")}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-amber-200/80">
                            Up next {index + 1}
                          </p>
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
                {queueCaptions.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-center text-xs text-slate-300">
                    No queued captions yet.
                  </div>
                )}
              </div>
            </aside>
          </section>
        ) : (
          <section className="lux-float-in grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {filteredCaptions.map((caption, index) => {
              const myVote = myVotes[caption.id] ?? 0;
              const isSubmitting = submittingCaptionId === caption.id;
              const netScore = rankScoreByCaption[caption.id] ?? 0;

              return (
                <article
                  key={caption.id}
                  onClick={() => {
                    setViewMode("stage");
                    focusCaption(caption.id);
                  }}
                  className="lux-card lux-float-in group flex h-[430px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#121d3c]/80 shadow-[0_18px_45px_rgba(2,6,23,0.45)] transition hover:border-cyan-200/35"
                  style={{ animationDelay: `${(index % 9) * 55}ms` }}
                >
                  <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-3 py-2">
                    <div
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${
                        sortMode === "top"
                          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                          : "border-white/10 bg-black/15 text-slate-400"
                      }`}
                    >
                      Score {formatNetScore(netScore)}
                    </div>
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
                    <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void submitVote(caption.id, 1);
                          }}
                          disabled={isSubmitting}
                          title="Like this caption"
                          className={`rounded-full border px-3 py-1.5 font-medium transition ${
                            myVote === 1
                              ? "border-emerald-300 bg-emerald-400/25 text-emerald-100"
                              : "border-emerald-300/50 text-emerald-100 hover:bg-emerald-500/15"
                          } ${reactionPulseCaptionId === caption.id ? "ring-2 ring-emerald-300/40" : ""}`}
                        >
                          Like
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void submitVote(caption.id, -1);
                          }}
                          disabled={isSubmitting}
                          title="Dislike this caption"
                          className={`rounded-full border px-3 py-1.5 font-medium transition ${
                            myVote === -1
                              ? "border-rose-300 bg-rose-400/25 text-rose-100"
                              : "border-rose-300/50 text-rose-100 hover:bg-rose-500/15"
                          } ${reactionPulseCaptionId === caption.id ? "ring-2 ring-rose-300/40" : ""}`}
                        >
                          Dislike
                        </button>
                        <span className="text-[11px] text-slate-400">
                          {myVote === 1 ? "Liked" : myVote === -1 ? "Disliked" : "Not rated"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${
                            sortMode === "top"
                              ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                              : "border-white/10 bg-black/15 text-slate-400"
                          }`}
                        >
                          {formatNetScore(netScore)}
                        </span>
                      </div>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setViewMode("stage");
                          focusCaption(caption.id);
                        }}
                        title="Open this caption in stage view"
                        className="rounded-full border border-sky-200/35 px-3 py-1.5 text-xs font-medium text-sky-100 transition hover:bg-sky-400/10"
                      >
                        Open Stage
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
            {filteredCaptions.length === 0 && (
              <div className="col-span-full rounded-[24px] border border-white/10 bg-[#121d3c]/70 p-8 text-center text-sm text-slate-300">
                No captions match this filter yet.
              </div>
            )}
          </section>
        ))}
      </div>
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap");

        :root {
          --ui-ease: cubic-bezier(0.2, 0.7, 0, 1);
          --ui-fast: 150ms;
          --ui-med: 220ms;
          --ui-slow: 320ms;
          --lux-glow: rgba(56, 189, 248, 0.22);
        }

        body {
          font-family: "Space Grotesk", "Sora", sans-serif;
          letter-spacing: 0.005em;
          scroll-behavior: smooth;
        }

        ::selection {
          background: rgba(125, 211, 252, 0.25);
          color: #f8fafc;
        }

        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.35) rgba(15, 23, 42, 0.45);
        }

        *::-webkit-scrollbar {
          height: 10px;
          width: 10px;
        }

        *::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.45);
        }

        *::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.35);
          border-radius: 999px;
          border: 2px solid rgba(15, 23, 42, 0.45);
        }

        input {
          transition: border-color var(--ui-med) var(--ui-ease), box-shadow var(--ui-med) var(--ui-ease),
            background-color var(--ui-med) var(--ui-ease);
        }

        input:focus {
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.18);
        }

        .title-display {
          font-family: "Fraunces", "Times New Roman", serif;
          font-weight: 650;
          letter-spacing: -0.01em;
        }

        button {
          transition-timing-function: var(--ui-ease);
          transition-property: transform, box-shadow, background-color, border-color, opacity, color;
          transition-duration: var(--ui-med);
          will-change: transform;
        }

        button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(2, 6, 23, 0.35);
        }

        button:active:not(:disabled) {
          transform: translateY(0);
          transition-duration: var(--ui-fast);
        }

        .lux-root {
          isolation: isolate;
        }

        .lux-aurora {
          animation: luxAuroraShift 24s ease-in-out infinite alternate;
        }

        .lux-grid {
          animation: luxGridShift 30s linear infinite;
        }

        .lux-noise {
          opacity: 0.08;
          background-image: radial-gradient(rgba(255, 255, 255, 0.3) 0.4px, transparent 0.4px);
          background-size: 3px 3px;
          mix-blend-mode: soft-light;
        }

        .lux-orb {
          filter: blur(38px);
          opacity: 0.2;
          animation: luxOrbDrift 16s ease-in-out infinite;
        }

        .lux-orb-a {
          background: radial-gradient(circle at 40% 40%, rgba(16, 185, 129, 0.45), rgba(16, 185, 129, 0));
        }

        .lux-orb-b {
          background: radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.45), rgba(59, 130, 246, 0));
          animation-delay: -4s;
        }

        .lux-panel {
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 22px 58px rgba(2, 6, 23, 0.48);
          position: relative;
        }

        .lux-card {
          backdrop-filter: blur(14px);
          position: relative;
          overflow: hidden;
          transition: transform var(--ui-med) var(--ui-ease), box-shadow var(--ui-med) var(--ui-ease),
            border-color var(--ui-med) var(--ui-ease);
        }

        .lux-card::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(
            420px circle at var(--mx, -30%) var(--my, -30%),
            rgba(255, 255, 255, 0.14),
            transparent 40%
          );
          opacity: 0;
          transition: opacity var(--ui-med) var(--ui-ease);
          pointer-events: none;
        }

        .lux-card:hover {
          transform: translateY(-4px);
          box-shadow:
            0 18px 44px rgba(2, 6, 23, 0.45),
            0 0 0 1px rgba(148, 163, 184, 0.2);
        }

        .lux-card:hover::before {
          opacity: 1;
        }

        .lux-float-in {
          animation: luxFadeInUp 620ms var(--ui-ease) both;
        }

        .lux-chip {
          border: 1px solid rgba(148, 163, 184, 0.18);
          transition: border-color var(--ui-med) var(--ui-ease), background-color var(--ui-med) var(--ui-ease),
            color var(--ui-med) var(--ui-ease), box-shadow var(--ui-med) var(--ui-ease);
        }

        .lux-chip-active {
          box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22), 0 8px 20px rgba(15, 23, 42, 0.35);
        }

        .lux-glow-btn {
          box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.2), 0 14px 28px rgba(245, 158, 11, 0.15);
        }

        @keyframes luxFadeInUp {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.995);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes luxAuroraShift {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
            filter: saturate(1);
          }
          100% {
            transform: translate3d(0, -8px, 0) scale(1.04);
            filter: saturate(1.12);
          }
        }

        @keyframes luxGridShift {
          0% {
            background-position: 0 0, 0 0;
          }
          100% {
            background-position: 52px 0, 0 52px;
          }
        }

        @keyframes luxOrbDrift {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(18px, -14px, 0);
          }
        }

        @keyframes luxShimmer {
          0%,
          70%,
          100% {
            transform: translateX(-110%);
          }
          85% {
            transform: translateX(110%);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .lux-aurora,
          .lux-grid,
          .lux-orb,
          .lux-panel::after,
          .lux-float-in {
            animation: none !important;
          }

          button,
          .lux-card {
            transition: none !important;
          }
        }

        .meme-text {
          font-family: Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif;
          font-size: clamp(1rem, 2vw, 1.5rem);
          line-height: 1.05;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #fff;
          text-shadow:
            -2px -2px 0 #000,
            2px -2px 0 #000,
            -2px 2px 0 #000,
            2px 2px 0 #000,
            0 3px 6px rgba(0, 0, 0, 0.75);
          word-break: break-word;
        }
      `}</style>
    </main>
  );
}
