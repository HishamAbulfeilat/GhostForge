import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";

/* ── Types ─────────────────────────────────────────────────────────── */
type Tab = "agents" | "crews" | "history";

export interface Agent {
  id: string;
  name: string;
  role: string;
  goal: string;
  status: "idle" | "running" | "error";
  lastRun?: number;
}

export interface Crew {
  id: string;
  name: string;
  agentIds: string[];
  tasks: { id: string; description: string; agentId: string }[];
  status: "idle" | "running" | "completed" | "error";
  progress?: number; // 0-100
  startedAt?: number;
}

export interface RunRecord {
  id: string;
  crewId: string;
  crewName: string;
  status: "completed" | "error" | "cancelled";
  startedAt: number;
  finishedAt: number;
  summary?: string;
}

interface AgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  agents?: Agent[];
  crews?: Crew[];
  history?: RunRecord[];
  onCreateCrew?: (name: string, agentIds: string[], tasks: { description: string; agentId: string }[]) => void;
  onRunCrew?: (crewId: string) => void;
  onAgentAction?: (agentId: string, action: "start" | "stop") => void;
}

const STATUS_BADGES: Record<string, string> = {
  idle: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  running: "bg-[#1a6fff]/15 text-[#1a6fff] border-[#1a6fff]/30",
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ── Sub-components ─────────────────────────────────────────────────── */
function AgentRow({
  agent,
  selected,
  onToggle,
  onAction,
}: {
  agent: Agent;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onAction?: (id: string, action: "start" | "stop") => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        selected
          ? "bg-[#1a6fff]/5 border-[#1a6fff]/30"
          : "bg-[#0a0a0f] border-[#1a1a2e] hover:border-[#1a1a2e]/80"
      }`}
    >
      {onToggle && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(agent.id)}
          className="mt-1 accent-[#1a6fff]"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">{agent.name}</span>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${STATUS_BADGES[agent.status]}`}
          >
            {agent.status}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{agent.role}</p>
        <p className="text-xs text-gray-600 mt-1 line-clamp-2">{agent.goal}</p>
      </div>
      {onAction && (
        <button
          onClick={() => onAction(agent.id, agent.status === "running" ? "stop" : "start")}
          className={`flex-shrink-0 p-1.5 rounded-lg text-xs transition-colors ${
            agent.status === "running"
              ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : "bg-[#1a1a2e] text-gray-400 hover:text-white hover:bg-[#1a6fff]/20"
          }`}
        >
          {agent.status === "running" ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-1.5 bg-[#0a0a0f] rounded-full overflow-hidden">
      <div
        className="h-full bg-[#1a6fff] rounded-full transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────────── */
const AgentPanel: React.FC<AgentPanelProps> = ({
  isOpen,
  onClose,
  agents = [],
  crews = [],
  history = [],
  onCreateCrew,
  onRunCrew,
  onAgentAction,
}) => {
  const [tab, setTab] = useState<Tab>("agents");

  /* Crew creation state */
  const [crewName, setCrewName] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [tasks, setTasks] = useState<{ description: string; agentId: string }[]>([]);
  const [showCrewForm, setShowCrewForm] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  /* Reset on close */
  useEffect(() => {
    if (!isOpen) {
      setTab("agents");
      setShowCrewForm(false);
      setCrewName("");
      setSelectedAgentIds([]);
      setTasks([]);
    }
  }, [isOpen]);

  /* Click outside */
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

  const toggleAgent = useCallback((id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }, []);

  const addTask = useCallback(() => {
    setTasks((prev) => [...prev, { description: "", agentId: selectedAgentIds[0] || "" }]);
  }, [selectedAgentIds]);

  const updateTask = useCallback((idx: number, field: "description" | "agentId", value: string) => {
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  }, []);

  const removeTask = useCallback((idx: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleCreateCrew = useCallback(() => {
    if (!crewName.trim() || selectedAgentIds.length === 0) return;
    const validTasks = tasks.filter((t) => t.description.trim());
    onCreateCrew?.(crewName.trim(), selectedAgentIds, validTasks.length > 0 ? validTasks : []);
    setCrewName("");
    setSelectedAgentIds([]);
    setTasks([]);
    setShowCrewForm(false);
    setTab("crews");
  }, [crewName, selectedAgentIds, tasks, onCreateCrew]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed left-0 top-0 bottom-0 z-50 w-full max-w-md bg-[#111118] border-r border-[#1a1a2e] shadow-2xl shadow-black/60 flex flex-col animate-slide-in-left"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a2e]">
          <h2 className="text-sm font-semibold text-white">Agents</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#1a1a2e] text-gray-500 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#1a1a2e]">
          {(["agents", "crews", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-xs font-medium capitalize transition-colors border-b-2 ${
                tab === t
                  ? "text-[#1a6fff] border-[#1a6fff]"
                  : "text-gray-500 hover:text-gray-300 border-transparent"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* ── AGENTS TAB ──────────────────────────────────────── */}
          {tab === "agents" && (
            <div className="space-y-3">
              {agents.length === 0 ? (
                <div className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="text-sm text-gray-500">No agents configured</p>
                </div>
              ) : (
                agents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} onAction={onAgentAction} />
                ))
              )}
            </div>
          )}

          {/* ── CREWS TAB ──────────────────────────────────────── */}
          {tab === "crews" && (
            <div className="space-y-3">
              {/* New crew button */}
              {!showCrewForm && (
                <button
                  onClick={() => setShowCrewForm(true)}
                  className="w-full p-3 rounded-lg border border-dashed border-[#1a1a2e] text-gray-500 hover:text-[#1a6fff] hover:border-[#1a6fff]/30 text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Create Crew
                </button>
              )}

              {/* Crew creation form */}
              {showCrewForm && (
                <div className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg p-4 space-y-3">
                  <h3 className="text-xs font-medium text-gray-400">New Crew</h3>
                  <input
                    value={crewName}
                    onChange={(e) => setCrewName(e.target.value)}
                    placeholder="Crew name"
                    className="w-full bg-[#111118] border border-[#1a1a2e] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#1a6fff]/50 transition-colors"
                  />

                  {/* Agent selection */}
                  <div>
                    <p className="text-[10px] text-gray-500 mb-2">Select agents:</p>
                    <div className="space-y-1.5">
                      {agents.map((agent) => (
                        <AgentRow
                          key={agent.id}
                          agent={agent}
                          selected={selectedAgentIds.includes(agent.id)}
                          onToggle={toggleAgent}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Tasks */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-gray-500">Tasks:</p>
                      <button
                        onClick={addTask}
                        className="text-[10px] text-[#1a6fff] hover:underline"
                      >
                        + Add task
                      </button>
                    </div>
                    {tasks.map((task, i) => (
                      <div key={i} className="flex gap-2 mb-2">
                        <input
                          value={task.description}
                          onChange={(e) => updateTask(i, "description", e.target.value)}
                          placeholder="Task description"
                          className="flex-1 bg-[#111118] border border-[#1a1a2e] rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#1a6fff]/50 transition-colors"
                        />
                        <select
                          value={task.agentId}
                          onChange={(e) => updateTask(i, "agentId", e.target.value)}
                          className="bg-[#111118] border border-[#1a1a2e] rounded px-2 py-1.5 text-xs text-gray-400 focus:outline-none"
                        >
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeTask(i)}
                          className="text-gray-600 hover:text-red-400 text-xs px-1"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleCreateCrew}
                      disabled={!crewName.trim() || selectedAgentIds.length === 0}
                      className="flex-1 py-2 rounded-lg bg-[#1a6fff] text-white text-xs font-medium hover:bg-[#1a6fff]/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => setShowCrewForm(false)}
                      className="px-3 py-2 rounded-lg text-gray-500 text-xs hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Existing crews */}
              {crews.map((crew) => {
                const agentNames = crew.agentIds
                  .map((id) => agents.find((a) => a.id === id)?.name)
                  .filter(Boolean)
                  .join(", ");

                return (
                  <div
                    key={crew.id}
                    className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-200">{crew.name}</span>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${STATUS_BADGES[crew.status]}`}
                      >
                        {crew.status}
                      </span>
                    </div>
                    {agentNames && (
                      <p className="text-[10px] text-gray-600 mb-1">Agents: {agentNames}</p>
                    )}
                    {crew.tasks.length > 0 && (
                      <p className="text-[10px] text-gray-600 mb-2">
                        {crew.tasks.length} task{crew.tasks.length !== 1 ? "s" : ""}
                      </p>
                    )}
                    {crew.status === "running" && crew.progress !== undefined && (
                      <div className="mb-2">
                        <ProgressBar progress={crew.progress} />
                        <p className="text-[10px] text-gray-600 mt-1 text-end">{crew.progress}%</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => onRunCrew?.(crew.id)}
                        disabled={crew.status === "running"}
                        className="text-[10px] px-2.5 py-1 rounded bg-[#1a1a2e] text-gray-400 hover:text-white hover:bg-[#1a6fff]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        {crew.status === "running" ? "Running..." : "Run"}
                      </button>
                    </div>
                  </div>
                );
              })}

              {crews.length === 0 && !showCrewForm && (
                <div className="py-16 text-center">
                  <p className="text-sm text-gray-500">No crews yet</p>
                  <p className="text-xs text-gray-600 mt-1">
                    Create a crew to orchestrate multiple agents.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY TAB ─────────────────────────────────────── */}
          {tab === "history" && (
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-gray-500">No run history</p>
                </div>
              ) : (
                history.map((run) => (
                  <div
                    key={run.id}
                    className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-200">{run.crewName}</span>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${STATUS_BADGES[run.status]}`}
                      >
                        {run.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-600">
                      <span>{timeAgo(run.startedAt)}</span>
                      <span>
                        {Math.round((run.finishedAt - run.startedAt) / 1000)}s
                      </span>
                    </div>
                    {run.summary && (
                      <p className="text-xs text-gray-500 mt-2 leading-relaxed line-clamp-3">
                        {run.summary}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AgentPanel;
