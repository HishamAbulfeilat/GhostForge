import React, { useState, useCallback, useMemo } from "react";

/* ── Types ─────────────────────────────────────────────────────────── */
export interface ToolCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  status: "success" | "error" | "running";
}

export interface MemoryRecall {
  id: string;
  content: string;
  relevance?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  memoryRecalls?: MemoryRecall[];
  model?: string;
}

interface ChatMessageProps {
  message: Message;
  onCopy?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function renderMarkdown(raw: string): string {
  let html = raw
    /* code blocks first – protect from inner transforms */
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="bg-[#0d0d14] border border-[#1a1a2e] rounded-lg p-3 my-2 overflow-x-auto text-sm"><code class="lang-${lang}">${escaped}</code></pre>`;
    })
    /* inline code */
    .replace(/`([^`]+)`/g, '<code class="bg-[#0d0d14] border border-[#1a1a2e] px-1.5 py-0.5 rounded text-sm text-[#8b9bf4]">$1</code>')
    /* headers */
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2 text-white">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mt-4 mb-2 text-white">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2 text-white">$1</h1>')
    /* bold & italic */
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="font-bold text-white">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic text-gray-300">$1</em>')
    /* links */
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener" class="text-[#1a6fff] underline hover:text-[#3d8bff]">$1</a>'
    )
    /* unordered lists */
    .replace(/^[*-] (.+)$/gm, '<li class="ml-4 list-disc text-gray-300">$1</li>')
    /* paragraphs (lines that are not already wrapped) */
    .replace(/^(?!<[huplao])/gm, "")
    /* collapse empty lines */
    .replace(/\n{2,}/g, "\n");

  return html;
}

function userInitials(name?: string): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/* ── Sub-components ─────────────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={copy}
      className="p-1.5 rounded hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
      title="Copy code"
    >
      {copied ? (
        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);

  const statusColor =
    tool.status === "success"
      ? "text-green-400"
      : tool.status === "error"
        ? "text-red-400"
        : "text-yellow-400 animate-pulse";

  const statusIcon =
    tool.status === "running" ? (
      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    ) : tool.status === "success" ? (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ) : (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );

  return (
    <div className="my-1 border border-[#1a1a2e] rounded-lg overflow-hidden bg-[#0d0d14]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#111118] transition-colors text-left"
      >
        <span className={`${statusColor} flex-shrink-0`}>{statusIcon}</span>
        <span className="text-[#8b9bf4] font-mono text-xs font-medium">{tool.name}</span>
        <svg
          className={`w-3 h-3 ml-auto text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-[#1a1a2e]">
          {tool.args && Object.keys(tool.args).length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Arguments:</p>
              <pre className="text-xs text-gray-400 bg-[#0a0a0f] rounded p-2 overflow-x-auto">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}
          {tool.result && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Result:</p>
              <pre className="text-xs text-gray-400 bg-[#0a0a0f] rounded p-2 overflow-x-auto max-h-64 overflow-y-auto">
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemoryRecallCard({ recall }: { recall: MemoryRecall }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-1 border border-[#1a1a2e] rounded-lg overflow-hidden bg-[#0d0d14]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#111118] transition-colors text-left"
      >
        <svg className="w-3.5 h-3.5 text-[#b088f9] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="text-[#b088f9] text-xs font-medium">Memory Recall</span>
        {recall.relevance !== undefined && (
          <span className="text-xs text-gray-500 ml-auto">{Math.round(recall.relevance * 100)}%</span>
        )}
        <svg
          className={`w-3 h-3 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-[#1a1a2e]">
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">{recall.content}</p>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────────── */
const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onCopy,
  onRegenerate,
  onEdit,
  onDelete,
}) => {
  const [hovered, setHovered] = useState(false);

  const isUser = message.role === "user";

  const renderedHtml = useMemo(
    () => (isUser ? message.content : renderMarkdown(message.content)),
    [message.content, isUser]
  );

  const copyAll = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    onCopy?.(message.id);
  }, [message.id, message.content, onCopy]);

  return (
    <div
      className={`group flex gap-3 px-4 py-3 ${isUser ? "" : "bg-[#0c0c13]"} transition-colors`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
          isUser
            ? "bg-[#1a6fff]/20 text-[#1a6fff] border border-[#1a6fff]/30"
            : "bg-[#b088f9]/15 text-[#b088f9] border border-[#b088f9]/30"
        }`}
      >
        {isUser ? userInitials("You") : "G"}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-gray-400">
            {isUser ? "You" : "JARVIS"}
          </span>
          {message.model && (
            <span className="text-[10px] text-gray-600 bg-[#111118] px-1.5 py-0.5 rounded">
              {message.model}
            </span>
          )}
          <span className="text-[10px] text-gray-600">{relativeTime(message.timestamp)}</span>
        </div>

        {/* Memory recalls */}
        {message.memoryRecalls && message.memoryRecalls.length > 0 && (
          <div className="mb-2">
            {message.memoryRecalls.map((r) => (
              <MemoryRecallCard key={r.id} recall={r} />
            ))}
          </div>
        )}

        {/* Message body */}
        {isUser ? (
          <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div
            className="prose-sm text-gray-300 leading-relaxed [&_a]:text-[#1a6fff] [&_a]:underline [&_li]:ml-4 [&_li]:list-disc"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} tool={tc} />
            ))}
          </div>
        )}
      </div>

      {/* Hover actions */}
      {hovered && (
        <div className="flex-shrink-0 flex items-start gap-0.5 pt-1">
          <button
            onClick={copyAll}
            className="p-1.5 rounded hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
            title="Copy message"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          {!isUser && (
            <button
              onClick={() => onRegenerate?.(message.id)}
              className="p-1.5 rounded hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
              title="Regenerate"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {isUser && (
            <button
              onClick={() => onEdit?.(message.id)}
              className="p-1.5 rounded hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
              title="Edit"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => onDelete?.(message.id)}
            className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
