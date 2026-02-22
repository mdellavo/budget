import { useState } from "react";
import { findDuplicateMerchants, mergeMerchants } from "../api/client";
import type { MergeGroup } from "../api/client";

type GroupState = "pending" | "merged" | "skipped";

export default function MerchantMergePage() {
  const [groups, setGroups] = useState<MergeGroup[]>([]);
  const [editedNames, setEditedNames] = useState<Record<number, string>>({});
  const [editedLocations, setEditedLocations] = useState<Record<number, string>>({});
  const [groupStates, setGroupStates] = useState<Record<number, GroupState>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [merging, setMerging] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [groupErrors, setGroupErrors] = useState<Record<number, string>>({});
  const [hasRun, setHasRun] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Record<number, Set<number>>>({});

  async function handleFindDuplicates() {
    setAnalyzing(true);
    setError(null);
    setGroups([]);
    setEditedNames({});
    setEditedLocations({});
    setGroupStates({});
    setGroupErrors({});
    setSelectedMembers({});
    setHasRun(false);
    try {
      const result = await findDuplicateMerchants();
      setGroups(result.groups);
      const names: Record<number, string> = {};
      const locs: Record<number, string> = {};
      const selected: Record<number, Set<number>> = {};
      result.groups.forEach((g, i) => {
        names[i] = g.canonical_name;
        locs[i] = g.canonical_location ?? "";
        selected[i] = new Set(g.members.map((m) => m.id));
      });
      setEditedNames(names);
      setEditedLocations(locs);
      setSelectedMembers(selected);
      setHasRun(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to analyze merchants");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleMerge(index: number) {
    const group = groups[index];
    setMerging((prev) => ({ ...prev, [index]: true }));
    setGroupErrors((prev) => ({ ...prev, [index]: "" }));
    try {
      const checkedIds = [...(selectedMembers[index] ?? group.members.map((m) => m.id))];
      await mergeMerchants({
        canonical_name: editedNames[index] ?? group.canonical_name,
        canonical_location: editedLocations[index] || null,
        merchant_ids: checkedIds,
      });
      setGroupStates((prev) => ({ ...prev, [index]: "merged" }));
    } catch (e: unknown) {
      setGroupErrors((prev) => ({
        ...prev,
        [index]: e instanceof Error ? e.message : "Merge failed",
      }));
    } finally {
      setMerging((prev) => ({ ...prev, [index]: false }));
    }
  }

  function handleSkip(index: number) {
    setGroupStates((prev) => ({ ...prev, [index]: "skipped" }));
  }

  const resolvedCount = Object.values(groupStates).filter((s) => s !== "pending").length;
  const mergedCount = Object.values(groupStates).filter((s) => s === "merged").length;
  const skippedCount = Object.values(groupStates).filter((s) => s === "skipped").length;
  const allResolved = groups.length > 0 && resolvedCount === groups.length;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Merge Duplicate Merchants</h1>
      <p className="text-gray-500 text-sm mb-6">
        Claude will scan your merchants and suggest merges. Merchants with the same name but
        different locations are treated as different merchants.
      </p>

      <div className="mb-6">
        <button
          onClick={handleFindDuplicates}
          disabled={analyzing}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzing ? "Analyzing…" : "Find duplicates"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      )}

      {hasRun && groups.length === 0 && (
        <p className="text-gray-500 text-sm">No duplicate groups found.</p>
      )}

      {allResolved && (
        <div className="mb-6 p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm">
          Done — {mergedCount} merged, {skippedCount} skipped.
        </div>
      )}

      <div className="space-y-4">
        {groups.map((group, index) => {
          const state = groupStates[index] ?? "pending";
          const isDone = state !== "pending";
          return (
            <div
              key={index}
              className={
                "border rounded-lg p-4 " +
                (isDone ? "opacity-50 bg-gray-50 border-gray-200" : "bg-white border-gray-200")
              }
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Group {index + 1}
                </span>
                {state === "merged" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                    Merged
                  </span>
                )}
                {state === "skipped" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded-full">
                    Skipped
                  </span>
                )}
              </div>

              <div className="flex gap-3 mb-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Merge into</label>
                  <input
                    type="text"
                    value={editedNames[index] ?? ""}
                    onChange={(e) =>
                      setEditedNames((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                    disabled={isDone}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
                  />
                </div>
                <div className="w-40">
                  <label className="block text-xs text-gray-500 mb-1">Location</label>
                  <input
                    type="text"
                    value={editedLocations[index] ?? ""}
                    onChange={(e) =>
                      setEditedLocations((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                    disabled={isDone}
                    placeholder="none"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
                  />
                </div>
              </div>

              <ul className="space-y-1 mb-4">
                {group.members.map((m) => {
                  const checked = selectedMembers[index]?.has(m.id) ?? true;
                  return (
                    <li key={m.id} className="flex items-center justify-between text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isDone}
                          onChange={() => {
                            setSelectedMembers((prev) => {
                              const next = new Set(prev[index] ?? group.members.map((x) => x.id));
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return { ...prev, [index]: next };
                            });
                          }}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={checked ? "text-gray-700" : "text-gray-400 line-through"}>
                          {m.name}
                          {m.location && (
                            <span className="ml-1 text-xs opacity-60">— {m.location}</span>
                          )}
                        </span>
                      </label>
                      <span className="text-gray-400 text-xs">
                        {m.transaction_count} transactions
                      </span>
                    </li>
                  );
                })}
              </ul>

              {groupErrors[index] && (
                <p className="text-red-600 text-xs mb-3">{groupErrors[index]}</p>
              )}

              {!isDone && (
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleSkip(index)}
                    className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleMerge(index)}
                    disabled={
                      merging[index] ||
                      [...(selectedMembers[index] ?? group.members.map((m) => m.id))].length < 2
                    }
                    className="px-3 py-1.5 text-sm text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {merging[index] ? "Merging…" : "Merge →"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
