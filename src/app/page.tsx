import { supabase } from "@/lib/supabase";

type TermRow = {
  id: number;
  term: string;
  definition: string | null;
  example: string | null;
  priority: number | null;
  term_type_id: number | null;
  modified_datetime_utc: string | null;
};

function truncate(text: string, max = 80) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export default async function Home() {
  const { data, error } = await supabase
      .from("terms")
      .select(
          "id, term, definition, example, priority, term_type_id, modified_datetime_utc"
      )
      .order("priority", { ascending: false, nullsFirst: false })
      .limit(60); // medium-long, not too long

  if (error) {
    return (
        <main className="min-h-screen p-8">
          <h1 className="text-2xl font-semibold">Terms</h1>
          <p className="mt-4 text-red-600">Error: {error.message}</p>
          <p className="mt-2 text-slate-500">
            Double-check your table name and env vars.
          </p>
        </main>
    );
  }

  const rows = (data ?? []) as TermRow[];

  return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold">Terms</h1>
              <p className="mt-1 text-slate-300">
                Loaded from Supabase table{" "}
                <code className="font-mono">terms</code>
              </p>
            </div>

            <div className="text-sm text-slate-400">
              Showing <span className="text-slate-200 font-medium">{rows.length}</span>{" "}
              rows
            </div>
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-white/10 bg-white/5">
            <table className="min-w-[1100px] w-full border-collapse">
              <thead className="bg-white/5">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-300">
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">Definition</th>
                <th className="px-4 py-3">Example</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
              </thead>

              <tbody>
              {rows.map((r) => (
                  <tr
                      key={r.id}
                      className="border-t border-white/10 text-sm hover:bg-white/5"
                  >
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">
                      {r.term}
                    </td>

                    <td className="px-4 py-3 text-slate-200">
                      {r.definition ? truncate(r.definition, 90) : "—"}
                    </td>

                    <td className="px-4 py-3 text-slate-300">
                      {r.example ? truncate(r.example, 90) : "—"}
                    </td>

                    <td className="px-4 py-3 text-slate-300">
                      {r.priority ?? "—"}
                    </td>

                    <td className="px-4 py-3 text-slate-300">
                      {r.term_type_id ?? "—"}
                    </td>

                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {r.modified_datetime_utc
                          ? new Date(r.modified_datetime_utc).toLocaleDateString()
                          : "—"}
                    </td>
                  </tr>
              ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Tip: If you want it shorter/longer, change <code className="font-mono">limit(60)</code>.
          </p>
        </div>
      </main>
  );
}