import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export const DEFAULT_RECENT_COMMANDS_FILE = join(homedir(), '.ghostforge', 'recent-commands.json');

export function readRecentCommands(filePath = DEFAULT_RECENT_COMMANDS_FILE) {
  if (!existsSync(filePath)) return [];
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(value) ? value.filter(command => typeof command === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberCommand(command, filePath = DEFAULT_RECENT_COMMANDS_FILE) {
  const recent = [command, ...readRecentCommands(filePath).filter(item => item !== command)].slice(0, 5);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(recent, null, 2)}\n`);
  return recent;
}
