interface QuickCommand {
  label: string
  cmd: string
}

export function CommandPanel({ commands, onSelect }: { commands: QuickCommand[]; onSelect: (command: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-gray-800 bg-gray-900/90 px-4 py-2">
      {commands.map(command => (
        <button type="button"
          key={command.cmd}
          onClick={() => onSelect(`Run: ${command.cmd}`)}
          className="shrink-0 rounded-full border border-sky-950/60 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 transition hover:border-sky-600 hover:bg-gray-700"
        >
          {command.label}
        </button>
      ))}
    </div>
  )
}
