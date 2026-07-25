import { exec } from 'child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Supported game platforms */
export type GamePlatform = 'steam' | 'epic' | 'gog' | 'origin' | 'unknown';

/** Represents an installed game */
export interface InstalledGame {
  name: string;
  platform: GamePlatform;
  installPath: string;
  version: string;
  sizeBytes: number;
  lastPlayed?: number;
  appId?: string;
  manifest?: string;
}

/** Result of an update check */
export interface UpdateCheckResult {
  game: string;
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  updateSizeBytes: number;
}

/** Platform-specific library paths */
interface PlatformPaths {
  steam: string[];
  epic: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan for installed Steam games by reading ACF manifests.
 * Reads from standard Steam library folders per platform.
 */
export async function scanSteamGames(): Promise<InstalledGame[]> {
  const games: InstalledGame[] = [];
  const paths = getSteamPaths();

  for (const steamPath of paths) {
    const steamappsDir = join(steamPath, 'steamapps');
    if (!existsSync(steamappsDir)) continue;

    try {
      const entries = readdirSync(steamappsDir);
      const acfFiles = entries.filter(f => f.startsWith('appmanifest_') && f.endsWith('.acf'));

      for (const acfFile of acfFiles) {
        try {
          const acfPath = join(steamappsDir, acfFile);
          const content = readFileSync(acfPath, 'utf-8');
          const game = parseAcfManifest(content, steamappsDir);

          if (game) {
            games.push(game);
          }
        } catch {
          // Skip malformed manifest files
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return games;
}

/**
 * Scan for installed Epic Games by reading `.item` manifest files.
 */
export async function scanEpicGames(): Promise<InstalledGame[]> {
  const games: InstalledGame[] = [];
  const paths = getEpicPaths();

  for (const manifestDir of paths) {
    if (!existsSync(manifestDir)) continue;

    try {
      const entries = readdirSync(manifestDir);
      const manifestFiles = entries.filter(f => f.endsWith('.item'));

      for (const manifestFile of manifestFiles) {
        try {
          const manifestPath = join(manifestDir, manifestFile);
          const content = readFileSync(manifestPath, 'utf-8');
          const data = JSON.parse(content);

          const installPath = data.InstallLocation || '';
          const sizeBytes = existsSync(installPath)
            ? calculateDirSize(installPath)
            : 0;

          games.push({
            name: data.AppName || manifestFile.replace('.item', ''),
            platform: 'epic',
            installPath,
            version: data.AppVersion || data.BuildVersion || 'unknown',
            sizeBytes,
            appId: data.AppName,
            manifest: manifestFile,
          });
        } catch {
          // Skip malformed manifests
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return games;
}

/**
 * Check for available updates for a specific game.
 * Compares local version with the latest version from the platform's API.
 */
export async function checkForUpdates(gameName: string): Promise<UpdateCheckResult> {
  const allGames = await listAllGames();
  const game = allGames.find(
    g => g.name.toLowerCase() === gameName.toLowerCase()
  );

  if (!game) {
    return {
      game: gameName,
      hasUpdate: false,
      currentVersion: 'unknown',
      latestVersion: 'unknown',
      updateSizeBytes: 0,
    };
  }

  const latestVersion = await getLatestVersion(game);

  return {
    game: game.name,
    hasUpdate: latestVersion !== game.version && latestVersion !== 'unknown',
    currentVersion: game.version,
    latestVersion,
    updateSizeBytes: 0,
  };
}

/**
 * Trigger a game update via the platform's CLI.
 * - Steam: `steam://launch/<appid>/update`
 * - Epic: Opens the Epic Games Launcher update page
 */
export async function updateGame(gameName: string): Promise<string> {
  const allGames = await listAllGames();
  const game = allGames.find(
    g => g.name.toLowerCase() === gameName.toLowerCase()
  );

  if (!game) {
    throw new Error(`Game "${gameName}" not found`);
  }

  if (game.platform === 'steam' && game.appId) {
    return triggerSteamUpdate(game.appId);
  }

  if (game.platform === 'epic') {
    return triggerEpicUpdate(game.name);
  }

  throw new Error(`Automatic update not supported for ${game.platform} games`);
}

/**
 * List all installed games across all supported platforms.
 */
export async function listAllGames(): Promise<InstalledGame[]> {
  const [steamGames, epicGames] = await Promise.all([
    scanSteamGames(),
    scanEpicGames(),
  ]);

  // Deduplicate by name (keep the one with more info)
  const gameMap = new Map<string, InstalledGame>();

  for (const game of [...steamGames, ...epicGames]) {
    const existing = gameMap.get(game.name);
    if (!existing || (game.sizeBytes > existing.sizeBytes)) {
      gameMap.set(game.name, game);
    }
  }

  return [...gameMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Steam Helpers ───────────────────────────────────────────────────────────

function getSteamPaths(): string[] {
  const home = homedir();
  const platform = process.platform;

  const candidates: string[] = [];

  if (platform === 'darwin') {
    candidates.push(
      join(home, 'Library', 'Application Support', 'Steam'),
    );
  } else if (platform === 'win32') {
    candidates.push(
      join('C:', 'Program Files (x86)', 'Steam'),
      join('C:', 'Program Files', 'Steam'),
      join(home, 'AppData', 'Local', 'Steam'),
    );
  } else {
    candidates.push(
      join(home, '.steam', 'steam'),
      join(home, '.local', 'share', 'Steam'),
    );
  }

  // Also check additional Steam library folders
  const libraryFoldersPath = join(candidates[0] || '', 'steamapps', 'libraryfolders.json');
  if (existsSync(libraryFoldersPath)) {
    try {
      const data = JSON.parse(readFileSync(libraryFoldersPath, 'utf-8'));
      for (const [, folder] of Object.entries(data) as Array<[string, any]>) {
        if (folder.path && !candidates.includes(folder.path)) {
          candidates.push(folder.path);
        }
      }
    } catch {}
  }

  return candidates.filter(p => existsSync(p));
}

function parseAcfManifest(content: string, steamappsDir: string): InstalledGame | null {
  const fields: Record<string, string> = {};

  // Simple VDF parser for ACF files
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*"([^"]+)"\s+"([^"]*)"\s*$/);
    if (match) {
      fields[match[1]] = match[2];
    }
  }

  const name = fields['name'];
  const appId = fields['appid'];
  if (!name || !appId) return null;

  const installdir = fields['installdir'] || '';
  const installPath = join(steamappsDir, 'common', installdir);
  const sizeBytes = parseInt(fields['SizeOnDisk'] || '0', 10);

  return {
    name,
    platform: 'steam',
    installPath,
    version: fields['LastUpdated'] || 'unknown',
    sizeBytes,
    lastPlayed: fields['LastPlayTime'] ? parseInt(fields['LastPlayTime'], 10) * 1000 : undefined,
    appId,
  };
}

async function triggerSteamUpdate(appId: string): Promise<string> {
  const platform = process.platform;

  return new Promise((resolve, reject) => {
    let cmd: string;

    if (platform === 'darwin') {
      cmd = `open "steam://update/${appId}"`;
    } else if (platform === 'win32') {
      cmd = `start "" "steam://update/${appId}"`;
    } else {
      cmd = `xdg-open "steam://update/${appId}"`;
    }

    exec(cmd, (error) => {
      if (error) reject(new Error(`Failed to trigger Steam update: ${error.message}`));
      else resolve(`Update triggered for Steam app ${appId}`);
    });
  });
}

// ── Epic Helpers ────────────────────────────────────────────────────────────

function getEpicPaths(): string[] {
  const home = homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
    ];
  }

  if (platform === 'win32') {
    return [
      join('C:', 'ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
      join(home, 'AppData', 'Local', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
    ];
  }

  return [
    join(home, '.local', 'share', 'epicgames', 'Launcher', 'Data', 'Manifests'),
  ];
}

async function triggerEpicUpdate(gameName: string): Promise<string> {
  const platform = process.platform;

  return new Promise((resolve, reject) => {
    let cmd: string;

    if (platform === 'darwin') {
      cmd = `open "com.epicgames.launcher://apps/${gameName}?action=update"`;
    } else if (platform === 'win32') {
      cmd = `start "" "com.epicgames.launcher://apps/${gameName}?action=update"`;
    } else {
      cmd = `xdg-open "com.epicgames.launcher://apps/${gameName}?action=update"`;
    }

    exec(cmd, (error) => {
      if (error) reject(new Error(`Failed to trigger Epic update: ${error.message}`));
      else resolve(`Update triggered for ${gameName} in Epic Games Launcher`);
    });
  });
}

// ── Version Helpers ─────────────────────────────────────────────────────────

async function getLatestVersion(game: InstalledGame): Promise<string> {
  // Platform CLIs don't expose a reliable remote version query.
  // This returns 'unknown' when no online check succeeds.
  if (game.platform === 'steam' && game.appId) {
    return getSteamRemoteVersion(game.appId);
  }
  return 'unknown';
}

async function getSteamRemoteVersion(appId: string): Promise<string> {
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (response.ok) {
      const data: any = await response.json();
      if (data[appId]?.success) {
        return data[appId].data?.type || 'unknown';
      }
    }
  } catch {}
  return 'unknown';
}

// ── Utility ─────────────────────────────────────────────────────────────────

function calculateDirSize(dirPath: string): number {
  let totalSize = 0;

  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      try {
        const fullPath = join(dirPath, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          totalSize += calculateDirSize(fullPath);
        } else {
          totalSize += stat.size;
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {}

  return totalSize;
}
