export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  streaming?: boolean
}

function splitRunContent(content: string) {
  if (!content.includes('||RUN||')) {
    return { displayContent: content, runCommand: null as string | null }
  }

  const [displayContent, runCommand] = content.split('||RUN||')
  return { displayContent, runCommand: runCommand?.trim() || null }
}

export function MessageBubble({
  message,
  onRunCommand,
}: {
  message: ChatMessage
  onRunCommand: (command: string) => void
}) {
  const { displayContent, runCommand } = splitRunContent(message.content)

  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-[22px] px-4 py-3 shadow-sm ${
          message.role === 'user'
            ? 'bg-sky-600 text-white'
            : 'border border-gray-800 bg-gray-900/90 text-gray-100'
        }`}
      >
        <p className="whitespace-pre-wrap text-sm leading-6">
          {displayContent}
          {message.streaming && (
            <span className="ms-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current opacity-70" />
          )}
        </p>
        {runCommand ? (
          <button type="button"
            onClick={() => onRunCommand(runCommand)}
            className="mt-3 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-500"
          >
            ▶ Run on Mac
          </button>
        ) : null}
        <p className="mt-2 text-[11px] opacity-50">{message.timestamp.toLocaleTimeString()}</p>
      </div>
    </div>
  )
}
