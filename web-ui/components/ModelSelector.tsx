import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";

/* ── Types ─────────────────────────────────────────────────────────── */
export type ModelCategory = "all" | "local" | "cloud" | "huggingface";

export interface Model {
  id: string;
  name: string;
  provider: string;
  category: "local" | "cloud" | "huggingface";
  available: boolean;
  parameterSize?: string;
}

interface ModelSelectorProps {
  selectedModelId?: string;
  onSelect: (model: Model) => void;
  isOpen: boolean;
  onClose: () => void;
  apiEndpoint?: string;
}

const CATEGORY_TABS: { key: ModelCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "local", label: "Local" },
  { key: "cloud", label: "Cloud" },
  { key: "huggingface", label: "HuggingFace" },
];

const PROVIDER_COLORS: Record<string, string> = {
  ollama: "text-green-400",
  openai: "text-[#10b981]",
  anthropic: "text-[#d4a574]",
  azure: "text-[#0078d4]",
  huggingface: "text-[#ffd21e]",
};

function providerColor(provider: string): string {
  const key = provider.toLowerCase();
  for (const [k, v] of Object.entries(PROVIDER_COLORS)) {
    if (key.includes(k)) return v;
  }
  return "text-gray-400";
}

/* ── Component ─────────────────────────────────────────────────────── */
const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModelId,
  onSelect,
  isOpen,
  onClose,
  apiEndpoint = "/api/jarvis/models",
}) => {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ModelCategory>("all");
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ── Fetch models ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(apiEndpoint)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`);
        return res.json();
      })
      .then((data: Model[]) => {
        if (!cancelled) {
          setModels(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, apiEndpoint]);

  /* ── Focus search on open ────────────────────────────────────────── */
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      setSearch("");
      setCategory("all");
    }
  }, [isOpen]);

  /* ── Close on click outside ──────────────────────────────────────── */
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

  /* ── Filtered models ─────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    return models.filter((m) => {
      const matchesCategory = category === "all" || m.category === category;
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [models, category, search]);

  const handleSelect = useCallback(
    (model: Model) => {
      if (!model.available) return;
      onSelect(model);
      onClose();
    },
    [onSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-lg bg-[#111118] border border-[#1a1a2e] rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a2e]">
          <h2 className="text-sm font-semibold text-white">Select Model</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg pl-10 pr-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#1a6fff]/50 transition-colors"
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-5 pt-3 pb-1">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setCategory(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                category === tab.key
                  ? "bg-[#1a6fff]/15 text-[#1a6fff] border border-[#1a6fff]/30"
                  : "text-gray-500 hover:text-gray-300 border border-transparent hover:bg-[#1a1a2e]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Model list */}
        <div className="max-h-80 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <p className="text-sm text-red-400">{error}</p>
              <p className="text-xs text-gray-600 mt-1">Make sure JARVIS server is running.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">No models found</p>
              <p className="text-xs text-gray-600 mt-1">
                {models.length === 0 ? "No models loaded yet." : "Try a different search or category."}
              </p>
            </div>
          ) : (
            filtered.map((model) => {
              const isSelected = model.id === selectedModelId;
              return (
                <button
                  key={model.id}
                  onClick={() => handleSelect(model)}
                  disabled={!model.available}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isSelected
                      ? "bg-[#1a6fff]/10 border border-[#1a6fff]/30"
                      : "border border-transparent hover:bg-[#1a1a2e]"
                  } ${!model.available ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {/* Category badge */}
                  <span
                    className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      model.category === "local"
                        ? "bg-green-500/10 text-green-400"
                        : model.category === "cloud"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {model.category === "huggingface" ? "hf" : model.category}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 font-medium truncate">{model.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs ${providerColor(model.provider)}`}>{model.provider}</span>
                      {model.parameterSize && (
                        <span className="text-[10px] text-gray-600">{model.parameterSize}</span>
                      )}
                      {!model.available && (
                        <span className="text-[10px] text-red-400/70">unavailable</span>
                      )}
                    </div>
                  </div>

                  {/* Checkmark */}
                  {isSelected && (
                    <svg className="w-4 h-4 text-[#1a6fff] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1a1a2e] text-[10px] text-gray-600 flex items-center justify-between">
          <span>{filtered.length} model{filtered.length !== 1 ? "s" : ""}</span>
          <span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 mr-1" />
            {models.filter((m) => m.available).length} available
          </span>
        </div>
      </div>
    </div>
  );
};

export default ModelSelector;
