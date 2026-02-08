"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type TermRow = {
    id: number;
    term: string;
    definition: string | null;
    example: string | null;
    priority: number | null;
    term_type_id: number | null;
    modified_datetime_utc: string | null;
};

type TermTypeRow = {
    id: number;
    name: string;
};

function truncate(text: string, max = 80) {
    if (text.length <= max) return text;
    return text.slice(0, max - 3) + "...";
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
    supabaseUrl && supabaseAnonKey
        ? createClient(supabaseUrl, supabaseAnonKey)
        : null;

const palette = [
    "from-amber-300/30 via-orange-400/30 to-rose-500/30",
    "from-cyan-300/30 via-sky-400/30 to-indigo-500/30",
    "from-lime-300/30 via-emerald-400/30 to-teal-500/30",
    "from-fuchsia-300/30 via-pink-400/30 to-red-500/30",
    "from-yellow-200/30 via-amber-400/30 to-orange-500/30",
    "from-sky-300/30 via-blue-400/30 to-violet-500/30",
];

const seeded = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
};

export default function Home() {
    const [rows, setRows] = useState<TermRow[]>([]);
    const [types, setTypes] = useState<TermTypeRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!supabase) {
            setError("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
            setLoading(false);
            return;
        }

        (async () => {
            const { data: sessionData } = await supabase.auth.getSession();
            if (!sessionData.session) {
                window.location.href = "/login";
                return;
            }

            const { data, error } = await supabase
                .from("terms")
                .select(
                    "id, term, definition, example, priority, term_type_id, modified_datetime_utc"
                )
                .order("priority", { ascending: false, nullsFirst: false })
                .limit(90);

            const { data: typeData, error: typeError } = await supabase
                .from("term_types")
                .select("id, name")
                .order("id");

            if (error) {
                setError(error.message);
            } else if (typeError) {
                setError(typeError.message);
            } else {
                setRows((data ?? []) as TermRow[]);
                setTypes((typeData ?? []) as TermTypeRow[]);
            }

            setLoading(false);
        })();
    }, []);

    const clusters = useMemo(() => {
        const typeMap = new Map<number, string>();
        types.forEach((t) => typeMap.set(t.id, t.name));

        const buckets = new Map<number, TermRow[]>();
        rows.forEach((row) => {
            const key = row.term_type_id ?? -1;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key)!.push(row);
        });

        return Array.from(buckets.entries()).map(([typeId, list], index) => ({
            typeId,
            name: typeMap.get(typeId) ?? "Unclassified",
            list,
            index,
        }));
    }, [rows, types]);

    const layout = useMemo(() => {
        const stopwords = new Set([
            "a",
            "an",
            "and",
            "are",
            "as",
            "at",
            "be",
            "but",
            "by",
            "for",
            "from",
            "has",
            "have",
            "in",
            "is",
            "it",
            "its",
            "of",
            "on",
            "or",
            "that",
            "the",
            "to",
            "was",
            "were",
            "with",
        ]);

        const tokenize = (text: string) =>
            text
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter((word) => word.length > 2 && !stopwords.has(word));

        const buildTfidf = (docs: string[]) => {
            const tf = docs.map((doc) => {
                const counts = new Map<string, number>();
                tokenize(doc).forEach((word) => {
                    counts.set(word, (counts.get(word) ?? 0) + 1);
                });
                return counts;
            });

            const df = new Map<string, number>();
            tf.forEach((counts) => {
                counts.forEach((_count, word) => {
                    df.set(word, (df.get(word) ?? 0) + 1);
                });
            });

            const idf = new Map<string, number>();
            df.forEach((count, word) => {
                idf.set(word, Math.log((1 + docs.length) / (1 + count)) + 1);
            });

            return tf.map((counts) => {
                const vec = new Map<string, number>();
                counts.forEach((count, word) => {
                    const weight = count * (idf.get(word) ?? 1);
                    vec.set(word, weight);
                });
                return vec;
            });
        };

        const cosine = (a: Map<string, number>, b: Map<string, number>) => {
            let dot = 0;
            let na = 0;
            let nb = 0;
            a.forEach((va, key) => {
                na += va * va;
                const vb = b.get(key);
                if (vb) dot += va * vb;
            });
            b.forEach((vb) => {
                nb += vb * vb;
            });
            if (na === 0 || nb === 0) return 0;
            return dot / Math.sqrt(na * nb);
        };

        const forceLayout = (terms: TermRow[], seedBase: number) => {
            const n = terms.length;
            if (n === 0) return [];
            const docs = terms.map(
                (t) => `${t.term} ${t.definition ?? ""} ${t.example ?? ""}`
            );
            const vectors = buildTfidf(docs);
            const sim = Array.from({ length: n }, () => Array(n).fill(0));
            for (let i = 0; i < n; i += 1) {
                for (let j = i + 1; j < n; j += 1) {
                    const value = cosine(vectors[i], vectors[j]);
                    sim[i][j] = value;
                    sim[j][i] = value;
                }
            }

            const positions = terms.map((term, idx) => {
                const angle = seeded(term.id + seedBase) * Math.PI * 2;
                const r = 4 + seeded(seedBase + idx * 7) * 7;
                return {
                    x: Math.cos(angle) * r,
                    y: Math.sin(angle) * r,
                };
            });

            const repulsion = 18;
            const attraction = 0.06;
            const damping = 0.55;
            const iterations = 80;

            for (let iter = 0; iter < iterations; iter += 1) {
                const disp = positions.map(() => ({ x: 0, y: 0 }));
                for (let i = 0; i < n; i += 1) {
                    for (let j = i + 1; j < n; j += 1) {
                        const dx = positions[i].x - positions[j].x;
                        const dy = positions[i].y - positions[j].y;
                        const dist = Math.max(0.6, Math.sqrt(dx * dx + dy * dy));
                        const force = repulsion / (dist * dist);
                        const fx = (dx / dist) * force;
                        const fy = (dy / dist) * force;
                        disp[i].x += fx;
                        disp[i].y += fy;
                        disp[j].x -= fx;
                        disp[j].y -= fy;
                    }
                }

                for (let i = 0; i < n; i += 1) {
                    for (let j = i + 1; j < n; j += 1) {
                        const weight = sim[i][j];
                        if (weight < 0.08) continue;
                        const dx = positions[i].x - positions[j].x;
                        const dy = positions[i].y - positions[j].y;
                        const dist = Math.max(0.6, Math.sqrt(dx * dx + dy * dy));
                        const target = 3.5 + (1 - weight) * 5.5;
                        const force = (dist - target) * attraction * weight;
                        const fx = (dx / dist) * force;
                        const fy = (dy / dist) * force;
                        disp[i].x -= fx;
                        disp[i].y -= fy;
                        disp[j].x += fx;
                        disp[j].y += fy;
                    }
                }

                for (let i = 0; i < n; i += 1) {
                    const jitter = (seeded(i + iter + seedBase) - 0.5) * 0.12;
                    positions[i].x += disp[i].x * damping + jitter;
                    positions[i].y += disp[i].y * damping - jitter;
                }
            }

            return positions;
        };

        const count = Math.max(clusters.length, 1);
        const radiusX = 30;
        const radiusY = 22;
        return clusters.map((cluster, idx) => {
            const angle = (Math.PI * 2 * idx) / count - Math.PI / 2;
            const jitter = (seeded(idx + cluster.list.length) - 0.5) * 6;
            const cx = 50 + Math.cos(angle) * radiusX + jitter;
            const cy = 52 + Math.sin(angle) * radiusY + jitter;
            const terms = cluster.list.slice(0, 14);
            const offsets = forceLayout(terms, idx * 23);
            const maxDist =
                offsets.reduce((max, p) => Math.max(max, Math.hypot(p.x, p.y)), 0) || 1;
            const clusterRadius = 9 + Math.min(8, terms.length * 0.5);
            const scale = clusterRadius / maxDist;
            const xScale = 1.15 + (seeded(idx * 11) - 0.5) * 0.2;
            const yScale = 0.9 + (seeded(idx * 17) - 0.5) * 0.2;
            const nodes = terms.map((term, tIdx) => {
                const jitter = (seeded(term.id + idx * 31) - 0.5) * 1.6;
                return {
                    term,
                    x: cx + offsets[tIdx].x * scale * xScale + jitter,
                    y: cy + offsets[tIdx].y * scale * yScale - jitter,
                };
            });
            return { cluster, center: { x: cx, y: cy }, nodes };
        });
    }, [clusters]);

    if (loading) {
        return (
            <main className="min-h-screen p-8 bg-slate-950 text-slate-100">
                <div className="text-slate-300 text-sm">Loading terms...</div>
            </main>
        );
    }

    if (error) {
        return (
            <main className="min-h-screen p-8 bg-slate-950 text-slate-100">
                <h1 className="text-2xl font-semibold">Terms</h1>
                <p className="mt-4 text-red-400">Error: {error}</p>
                <p className="mt-2 text-slate-400">
                    Double-check your table name and env vars.
                </p>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100">
            <div className="relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.2),transparent_55%),radial-gradient(circle_at_80%_15%,rgba(251,191,36,0.24),transparent_45%),radial-gradient(circle_at_10%_85%,rgba(14,116,144,0.24),transparent_50%)]" />
                <div className="absolute inset-0 opacity-40 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:64px_64px]" />

                <div className="relative mx-auto max-w-6xl px-6 py-12">
                    <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                        <div className="space-y-4">
                            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[0.6rem] uppercase tracking-[0.4em] text-slate-300">
                                Atlas Mode
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
                            </span>
                            <h1 className="text-5xl font-semibold tracking-tight text-slate-50 md:text-6xl">
                                Cultural Term Atlas
                            </h1>
                                <p className="max-w-xl text-sm text-slate-300">
                                    A living star map of slang. Terms orbit their grammatical anchors,
                                    while positions inside each cluster are shaped by textual similarity.
                                </p>
                            <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.3em] text-slate-400">
                                <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
                                    {rows.length} entries
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
                                    {clusters.length} constellations
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-slate-300">
                            <button
                                onClick={async () => {
                                    if (!supabase) return;
                                    await supabase.auth.signOut();
                                    window.location.href = "/login";
                                }}
                                className="rounded-full border border-white/10 px-5 py-2 text-slate-100 hover:bg-white/10"
                            >
                                Sign out
                            </button>
                            <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
                                Focus:{" "}
                                <span className="text-slate-100">
                                    {clusters[0]?.name ?? "Unclassified"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_280px]">
                        <div className="atlas-field relative h-[72vh] overflow-hidden rounded-[32px] border border-white/10 bg-slate-900/50 p-6">
                            <div className="absolute inset-0 rounded-[32px] bg-[radial-gradient(circle_at_center,rgba(148,163,184,0.12),transparent_60%)]" />
                            <div className="absolute -inset-[1px] rounded-[32px] bg-gradient-to-br from-white/10 via-transparent to-white/5 opacity-60" />

                            <svg className="absolute inset-0 h-full w-full">
                                {layout.flatMap((item) =>
                                    item.nodes.map((node) => (
                                        <line
                                            key={`${item.cluster.typeId}-${node.term.id}`}
                                            x1={`${item.center.x}%`}
                                            y1={`${item.center.y}%`}
                                            x2={`${node.x}%`}
                                            y2={`${node.y}%`}
                                            stroke="rgba(148,163,184,0.24)"
                                            strokeWidth="1"
                                        />
                                    ))
                                )}
                            </svg>

                            {layout.map((item, index) => (
                                <div key={`cluster-${item.cluster.typeId}`} className="contents">
                                    <div
                                        className={`pointer-events-none absolute z-30 rounded-full border border-white/30 bg-gradient-to-br ${palette[index % palette.length]} px-4 py-2 text-[0.65rem] uppercase tracking-[0.25em] text-white shadow-[0_10px_30px_rgba(15,23,42,0.45)] ring-1 ring-black/20 backdrop-blur`}
                                        style={{
                                            left: `${item.center.x}%`,
                                            top: `${item.center.y}%`,
                                            transform: "translate(-50%, -50%)",
                                        }}
                                    >
                                        {item.cluster.name}
                                    </div>

                                    {item.nodes.map((node, nodeIndex) => (
                                        <div
                                            key={`node-${node.term.id}`}
                                            className="atlas-node group absolute z-10"
                                            style={{
                                                left: `${node.x}%`,
                                                top: `${node.y}%`,
                                                transform: "translate(-50%, -50%)",
                                                animationDelay: `${(nodeIndex % 6) * 0.35}s`,
                                            }}
                                        >
                                            <div className="relative atlas-dot">
                                                <span className="absolute inset-0 rounded-full bg-white/40 blur-md animate-atlas-glow" />
                                                <span className="block h-3.5 w-3.5 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,0.65)] animate-atlas-pulse" />
                                            </div>
                                            <div className="atlas-tooltip pointer-events-none absolute bottom-6 left-1/2 top-auto z-40 w-60 -translate-x-1/2 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-xs text-slate-100 opacity-0 shadow-[0_20px_50px_rgba(15,23,42,0.6)] backdrop-blur transition group-hover:opacity-100">
                                                <p className="text-sm font-semibold text-slate-100">
                                                    {node.term.term}
                                                </p>
                                                <p className="mt-2 text-slate-300">
                                                    {node.term.definition
                                                        ? truncate(node.term.definition, 140)
                                                        : "No definition yet."}
                                                </p>
                                                {node.term.example && (
                                                    <p className="mt-2 text-[0.7rem] text-slate-400">
                                                        “{truncate(node.term.example, 90)}”
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-[24px] border border-white/10 bg-slate-900/60 p-5">
                                <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">
                                    Constellation Index
                                </h2>
                                <div className="mt-4 space-y-3">
                                    {clusters.map((cluster, index) => (
                                        <div
                                            key={`legend-${cluster.typeId}`}
                                            className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span
                                                        className={`h-3 w-3 rounded-full bg-gradient-to-br ${palette[index % palette.length]}`}
                                                    />
                                                    <span className="text-sm text-slate-200">
                                                        {cluster.name}
                                                    </span>
                                                </div>
                                                <span className="text-xs text-slate-400">
                                                    {cluster.list.length}
                                                </span>
                                            </div>
                                            <p className="mt-2 text-xs text-slate-400">
                                                Sample:{" "}
                                                {cluster.list[0]?.term ?? "No terms yet"}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-[24px] border border-white/10 bg-gradient-to-br from-slate-900/70 via-slate-950/70 to-slate-900/70 p-5 text-xs text-slate-300">
                                <p className="text-[0.7rem] uppercase tracking-[0.3em] text-slate-400">
                                    Atlas Note
                                </p>
                                <p className="mt-3">
                                    Cluster layout is driven by{" "}
                                    <code className="font-mono">term_type_id</code>. Add new types
                                    to expand the map and create new constellations.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <style jsx global>{`
                @import url("https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap");

                body {
                    font-family: "Space Grotesk", "Sora", sans-serif;
                }

                h1,
                h2 {
                    font-family: "Fraunces", "Times New Roman", serif;
                }

                @keyframes atlasPulse {
                    0%,
                    100% {
                        transform: scale(1);
                        opacity: 0.8;
                    }
                    50% {
                        transform: scale(1.35);
                        opacity: 1;
                    }
                }

                @keyframes atlasGlow {
                    0%,
                    100% {
                        opacity: 0.2;
                        transform: scale(1);
                    }
                    50% {
                        opacity: 0.6;
                        transform: scale(1.8);
                    }
                }

                .animate-atlas-pulse {
                    animation: atlasPulse 3.2s ease-in-out infinite;
                }

                .animate-atlas-glow {
                    animation: atlasGlow 4.4s ease-in-out infinite;
                }

                .atlas-field:hover .atlas-node .atlas-dot {
                    opacity: 0.25;
                    filter: blur(1px);
                }

                .atlas-field:hover .atlas-node:hover {
                    z-index: 30;
                }

                .atlas-field:hover .atlas-node:hover .atlas-dot {
                    opacity: 1;
                    filter: none;
                }
            `}</style>
        </main>
    );
}
