import React, { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ChangeEvent } from "react";

/* ── Types ─────────────────────────────────────────────────────────── */
export interface Command {
  name: string;
  label: string;
  icon: string;
}

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
  isThinking?: boolean;
  commands?: Command[];
  maxLength?: number;
}

const DEFAULT_COMMANDS: Command[] = [
  { name: "/review", label: "Review", icon: "R" },
  { name: "/fix", label: "Fix", icon: "F" },
  { name: "/explain", label: "Explain", icon: "E" },
  { name: "/test", label: "Test", icon: "T" },
  { name: "/refactor", label: "Refactor", icon: "Re" },
  { name: "/pentest", label: "Pentest", icon: "P" },
];

/* ── Component ─────────────────────────────────────────────────────── */
const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  isThinking = false,
  commands = DEFAULT_COMMANDS,
  maxLength = 10000,
}) => {
  const [value, setValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  /* ── Auto-resize ────────────────────────────────────────────────── */
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollHeight = el.scrollHeight;
    const maxHeight = 8 * 24; /* ~8 rows */
    el.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  /* ── Send ───────────────────────────────────────────────────────── */
  const send = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    if (isThinking) return;
    onSend(trimmed, pendingFiles.length > 0 ? pendingFiles : undefined);
    setValue("");
    setPendingFiles([]);
    textareaRef.current?.focus();
  }, [value, pendingFiles, isThinking, onSend]);

  /* ── Keyboard ───────────────────────────────────────────────────── */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  /* ── Text change ────────────────────────────────────────────────── */
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      if (e.target.value.length <= maxLength) {
        setValue(e.target.value);
      }
    },
    [maxLength]
  );

  /* ── Voice (Web Speech API) ─────────────────────────────────────── */
  const toggleVoice = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI: any =
      typeof window !== "undefined"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognitionAPI) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setValue((prev) => {
        const base = prev.endsWith(" ") || prev.length === 0 ? prev : prev + " ";
        return base + transcript;
      });
    };

    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);

    // Stop any instance that might still be running to avoid InvalidStateError
    try {
      recognitionRef.current?.stop();
    } catch { /* ignore */ }
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsRecording(true);
    } catch {
      // start() can throw InvalidStateError if a session is still active
      setIsRecording(false);
    }
  }, [isRecording]);

  /* ── Stop recognition on unmount ───────────────────────────────────── */
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch { /* ignore */ }
    };
  }, []);

  /* ── File upload ────────────────────────────────────────────────── */
  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setPendingFiles((prev) => [...prev, ...Array.from(files)]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeFile = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  /* ── Quick command insert ───────────────────────────────────────── */
  const insertCommand = useCallback((cmd: string) => {
    setValue((prev) => (prev.length > 0 ? prev + " " + cmd + " " : cmd + " "));
    textareaRef.current?.focus();
  }, []);

  const charCount = value.length;
  const showCount = charCount > 200;

  return (
    <div className="border-t border-[#1a1a2e] bg-[#0a0a0f]">
      {/* Pending files */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {pendingFiles.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1 text-xs bg-[#111118] border border-[#1a1a2e] text-gray-400 rounded px-2 py-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {f.name}
              <button
                onClick={() => removeFile(i)}
                className="ml-1 text-gray-500 hover:text-red-400 transition-colors"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Quick commands */}
      <div className="flex gap-1.5 px-4 pt-3 pb-1 overflow-x-auto no-scrollbar">
        {commands.map((cmd) => (
          <button
            key={cmd.name}
            onClick={() => insertCommand(cmd.name)}
            className="flex-shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full border border-[#1a1a2e] text-gray-500 hover:text-[#1a6fff] hover:border-[#1a6fff]/40 bg-[#111118] transition-colors"
          >
            {cmd.label}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="flex items-end gap-2 px-4 pb-4 pt-2">
        {/* File upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 p-2 rounded-lg text-gray-500 hover:text-white hover:bg-[#1a1a2e] transition-colors mb-0.5"
          title="Attach file"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={isThinking ? "JARVIS is thinking..." : "Message JARVIS..."}
            disabled={isThinking}
            className="w-full resize-none bg-[#111118] border border-[#1a1a2e] rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#1a6fff]/50 focus:ring-1 focus:ring-[#1a6fff]/20 disabled:opacity-50 transition-colors overflow-hidden"
          />
          {showCount && (
            <span
              className={`absolute bottom-2 right-3 text-[10px] ${charCount > maxLength * 0.9 ? "text-red-400" : "text-gray-600"}`}
            >
              {charCount.toLocaleString()} / {maxLength.toLocaleString()}
            </span>
          )}
        </div>

        {/* Voice */}
        <button
          onClick={toggleVoice}
          className={`flex-shrink-0 p-2 rounded-lg transition-colors mb-0.5 ${
            isRecording
              ? "bg-red-500/20 text-red-400 animate-pulse"
              : "text-gray-500 hover:text-white hover:bg-[#1a1a2e]"
          }`}
          title={isRecording ? "Stop recording" : "Voice input"}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </button>

        {/* Send */}
        {isThinking ? (
          <div className="flex-shrink-0 p-2 mb-0.5">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-[#1a6fff] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        ) : (
          <button
            onClick={send}
            disabled={!value.trim() && pendingFiles.length === 0}
            className="flex-shrink-0 p-2.5 rounded-xl bg-[#1a6fff] text-white hover:bg-[#1a6fff]/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all mb-0.5"
            title="Send message"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
