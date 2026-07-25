import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";

/* ── Types ─────────────────────────────────────────────────────────── */
export type MemoryCategory = "all" | "project" | "preference" | "code" | "conversation";

export interface MemoryEntry {
  id: string;
  content: string;
  category: Exclude<MemoryCategory, "all">;
  createdAt: number;
  updatedAt?: number;
  tags?: string[];
}

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  memories?: MemoryEntry[];
  onAdd?: (content: string, category: MemoryEntry["category"]) => void;
  onUpdate?: (id: string, content: string) => void;
  onDelete?: (id: string) => void;
  onExport?: () => void;
  onImport?: (data: MemoryEntry[]) => void;
}

const CATEGORY_TABS: { key: MemoryCategory; label: string; color: string }[] = [
  { key: "all", label: "All", color: "text-gray-400" },
  { key: "project", label: "Project", color: "text-[#1a6fff]" },
  { key: "preference", label: "Preference", color: "text-[#10b981]" },
  { key: "code", label: "Code", color: "text-[#f59e0b]" },
  { key: "conversation", label: "Conversation", color: "text-[#b088f9]" },
];

const CATEGORY_COLORS: Record<string, string> = {
  project: "bg-[#1a6fff]/15 text-[#1a6fff] border-[#1a6fff]/30",
  preference: "bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30",
  code: "bg-[#f59e0b]/15 text-[#f59e0b] border-[#f59e0b]/30",
  conversation: "bg-[#b088f9]/15 text-[#b088f9] border-[#b088f9]/30",
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* ── Component ─────────────────────────────────────────────────────── */
const MemoryPanel: React.FC<MemoryPanelProps> = ({
  isOpen,
  onClose,
  memories = [],
  onAdd,
  onUpdate,
  onDelete,
  onExport,
  onImport,
}) => {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryEntry["category"]>("project");
  const importRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /* ── Reset on close ────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setCategory("all");
      setEditingId(null);
      setNewContent("");
    }
  }, [isOpen]);

  /* ── Click outside to close ────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  /* ── Filtered memories ─────────────────────────────────────────── */
  const filtered = useMemo(() => {
    return memories.filter((m) => {
      const matchCat = category === "all" || m.category === category;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        m.content.toLowerCase().includes(q) ||
        m.tags?.some((t) => t.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [memories, category, search]);

  /* ── Stats ─────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const total = memories.length;
    const byCat = memories.reduce(
      (acc, m) => {
        acc[m.category] = (acc[m.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return { total, byCat };
  }, [memories]);

  /* ── Handlers ──────────────────────────────────────────────────── */
  const handleAdd = useCallback(() => {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    onAdd?.(trimmed, newCategory);
    setNewContent("");
  }, [newContent, newCategory, onAdd]);

  const startEdit = useCallback((m: MemoryEntry) => {
    setEditingId(m.id);
    setEditContent(m.content);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId && editContent.trim()) {
      onUpdate?.(editingId, editContent.trim());
    }
    setEditingId(null);
    setEditContent("");
  }, [editingId, editContent, onUpdate]);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport();
      return;
    }
    const json = JSON.stringify(memories, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghostforge-memory-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [memories, onExport]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as MemoryEntry[];
          onImport?.(data);
        } catch {
          alert("Invalid JSON file.");
        }
      };
      reader.readAsText(file);
      if (importRef.current) importRef.current.value = "";
    },
    [onImport]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-[#111118] border-l border-[#1a1a2e] shadow-2xl shadow-black/60 flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a2e]">
          <div>
            <h2 className="text-sm font-semibold text-white">Memory</h2>
            <p className="text-[10px] text-gray-600 mt-0.5">
              {stats.total} {stats.total === 1 ? "entry" : "entries"} stored
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="p-1.5 rounded-lg hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
              title="Export"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <button
              onClick={() => importRef.current?.click()}
              className="p-1.5 rounded-lg hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
              title="Import"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories..."
              className="w-full bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg pl-10 pr-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#1a6fff]/50 transition-colors"
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-5 pt-3 pb-1 overflow-x-auto no-scrollbar">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setCategory(tab.key)}
              className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                category === tab.key
                  ? `bg-[#1a1a2e] ${tab.color} border border-current/20`
                  : "text-gray-500 hover:text-gray-300 border border-transparent"
              }`}
            >
              {tab.label}
              {tab.key !== "all" && stats.byCat[tab.key] !== undefined && (
                <span className="ml-1 text-[10px] opacity-60">{stats.byCat[tab.key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="w-10 h-10 mx-auto text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-sm text-gray-500">No memories yet</p>
              <p className="text-xs text-gray-600 mt-1">Add a memory below to get started.</p>
            </div>
          ) : (
            filtered.map((m) => (
              <div
                key={m.id}
                className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg p-3 group hover:border-[#1a1a2e]/80 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[m.category]}`}
                  >
                    {m.category}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(m)}
                      className="p-1 rounded hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDelete?.(m.id)}
                      className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {editingId === m.id ? (
                  <div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-[#111118] border border-[#1a6fff]/30 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none resize-none"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={saveEdit}
                        className="text-xs px-3 py-1 rounded bg-[#1a6fff] text-white hover:bg-[#1a6fff]/90 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs px-3 py-1 rounded text-gray-500 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-300 leading-relaxed">{m.content}</p>
                )}

                <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-600">
                  <span>{timeAgo(m.createdAt)}</span>
                  {m.updatedAt && <span>edited</span>}
                  {m.tags && m.tags.length > 0 && (
                    <span className="text-gray-700">{m.tags.join(", ")}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add memory */}
        <div className="border-t border-[#1a1a2e] p-4">
          <div className="flex gap-2 mb-2">
            {(["project", "preference", "code", "conversation"] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setNewCategory(cat)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  newCategory === cat
                    ? CATEGORY_COLORS[cat]
                    : "border-transparent text-gray-600 hover:text-gray-400"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Add a new memory..."
              className="flex-1 bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#1a6fff]/50 transition-colors"
            />
            <button
              onClick={handleAdd}
              disabled={!newContent.trim()}
              className="px-3 py-2 rounded-lg bg-[#1a6fff] text-white text-sm font-medium hover:bg-[#1a6fff]/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Add
            </button>
          </div>
        </div>

        {/* Stats footer */}
        <div className="px-5 py-2.5 border-t border-[#1a1a2e] text-[10px] text-gray-600 flex items-center justify-between">
          <span>
            {filtered.length} of {stats.total} shown
          </span>
          <div className="flex gap-2">
            {Object.entries(stats.byCat).map(([cat, count]) => (
              <span key={cat}>
                {cat}: {count}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default MemoryPanel;
