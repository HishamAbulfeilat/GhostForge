import React, { useState, useCallback, useMemo } from "react";

/* ── Types ─────────────────────────────────────────────────────────── */
export type ToolStatus = "success" | "error" | "running";

export type DetectedType = "json" | "code" | "table" | "image" | "text";

export interface ToolResultProps {
  toolName: string;
  status: ToolStatus;
  result?: string;
  error?: string;
  defaultCollapsed?: boolean;
  onCopy?: (content: string) => void;
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function detectType(content: string): DetectedType {
  const trimmed = content.trim();

  /* Image data URLs or URLs */
  if (/^data:image\//.test(trimmed) || /^https?:\/\/.+\.(png|jpe?g|gif|svg|webp)/i.test(trimmed)) {
    return "image";
  }

  /* JSON */
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* not valid JSON */
    }
  }

  /* Code block indicators */
  if (/^```/.test(trimmed) || /(?:function|class|import|const|let|var|def|return|if\s*\()/m.test(trimmed)) {
    return "code";
  }

  /* Table detection (pipe-separated or tab-separated rows) */
  const lines = trimmed.split("\n");
  if (lines.length > 1) {
    const hasPipes = lines.filter((l) => l.includes("|")).length >= 2;
    const hasTabs = lines.filter((l) => l.includes("\t")).length >= 2;
    if (hasPipes || hasTabs) return "table";
  }

  return "text";
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function parseTable(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.trim().split("\n").filter((l) => l.trim());

  const splitLine = (line: string): string[] => {
    if (line.includes("|")) {
      return line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c && !/^[-:\s]+$/.test(c));
    }
    return line.split("\t").map((c) => c.trim());
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

function truncate(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "\n... (truncated)";
}

/* ── Component ─────────────────────────────────────────────────────── */
const ToolResult: React.FC<ToolResultProps> = ({
  toolName,
  status,
  result,
  error,
  defaultCollapsed = false,
  onCopy,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const displayContent = error || result || "";
  const detectedType = useMemo(() => detectType(displayContent), [displayContent]);
  const formattedContent = useMemo(() => {
    if (detectedType === "json") return formatJson(displayContent);
    return truncate(displayContent, 5000);
  }, [displayContent, detectedType]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(displayContent);
    onCopy?.(displayContent);
  }, [displayContent, onCopy]);

  const statusConfig = {
    success: {
      color: "text-green-400",
      bg: "bg-green-500/10",
      border: "border-green-500/30",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    error: {
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
    },
    running: {
      color: "text-[#1a6fff]",
      bg: "bg-[#1a6fff]/10",
      border: "border-[#1a6fff]/30",
      icon: (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ),
    },
  };

  const cfg = statusConfig[status];

  /* ── Renderers ────────────────────────────────────────────────── */
  const renderJson = () => (
    <pre className="text-xs text-[#8b9bf4] bg-[#0a0a0f] rounded-lg p-3 overflow-x-auto max-h-80 overflow-y-auto font-mono leading-relaxed">
      {formattedContent}
    </pre>
  );

  const renderCode = () => {
    const content = formattedContent.replace(/^```\w*\n?/gm, "").replace(/```$/gm, "").trim();
    return (
      <pre className="text-xs text-gray-300 bg-[#0a0a0f] rounded-lg p-3 overflow-x-auto max-h-80 overflow-y-auto font-mono leading-relaxed">
        {content}
      </pre>
    );
  };

  const renderTable = () => {
    const { headers, rows } = parseTable(displayContent);
    return (
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-start text-gray-400 font-medium border-b border-[#1a1a2e] bg-[#0a0a0f]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-[#1a1a2e]/50">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-gray-300">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderImage = () => {
    const src = displayContent.trim();
    if (src.startsWith("data:") || src.startsWith("http")) {
      return (
        <div className="p-2">
          <img
            src={src}
            alt="Tool output"
            className="max-w-full max-h-80 rounded-lg object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
          <p className="hidden text-xs text-gray-500 mt-2">Image failed to load.</p>
        </div>
      );
    }
    return <p className="text-xs text-gray-400 p-3">{displayContent}</p>;
  };

  const renderText = () => (
    <p className="text-xs text-gray-300 p-3 whitespace-pre-wrap leading-relaxed">{formattedContent}</p>
  );

  const renderContent = () => {
    switch (detectedType) {
      case "json":
        return renderJson();
      case "code":
        return renderCode();
      case "table":
        return renderTable();
      case "image":
        return renderImage();
      default:
        return renderText();
    }
  };

  const typeBadge: Record<DetectedType, string> = {
    json: "JSON",
    code: "CODE",
    table: "TABLE",
    image: "IMG",
    text: "TEXT",
  };

  return (
    <div
      className={`my-1.5 rounded-xl border overflow-hidden transition-colors ${
        status === "running"
          ? `${cfg.bg} ${cfg.border} animate-pulse`
          : `${cfg.bg} ${cfg.border}`
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-white/[0.02] transition-colors text-start"
      >
        <span className={`${cfg.color} flex-shrink-0`}>{cfg.icon}</span>
        <span className="text-xs font-mono font-medium text-gray-300">{toolName}</span>
        <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
          {typeBadge[detectedType]}
        </span>
        {status === "running" && (
          <span className="text-[10px] text-[#1a6fff] animate-pulse ms-1">running...</span>
        )}
        <div className="ms-auto flex items-center gap-1">
          {!collapsed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
              className="p-1 rounded hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
              title="Copy result"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          )}
          <svg
            className={`w-3.5 h-3.5 text-gray-500 transition-transform ${collapsed ? "" : "rotate-180"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Content */}
      {!collapsed && displayContent && (
        <div className="border-t border-current/10">{renderContent()}</div>
      )}

      {/* Running spinner */}
      {!collapsed && status === "running" && !displayContent && (
        <div className="flex items-center justify-center py-8 border-t border-current/10">
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      )}

      {/* Error details */}
      {!collapsed && error && (
        <div className="px-3.5 pb-3 border-t border-red-500/10">
          <p className="text-xs text-red-400 mt-2">{error}</p>
        </div>
      )}
    </div>
  );
};

export default ToolResult;
