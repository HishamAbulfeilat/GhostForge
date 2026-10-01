import { execFile } from 'child_process';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import * as z from 'zod/v4';

const execFileAsync = promisify(execFile);
const defaultAllowedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function isOutside(root, candidate) {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    isAbsolute(relativePath)
  );
}

// Resolve symlinks on the deepest existing ancestor so a path that does not
// exist yet is still judged by where it would really land.
function realpathOfNearestExisting(targetPath) {
  let current = targetPath;
  const missing = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return targetPath;
    }
    missing.unshift(relative(parent, current));
    current = parent;
  }
  return resolve(realpathSync.native(current), ...missing);
}

function escapeError(projectPath, root) {
  return new Error(`Project path "${projectPath || '.'}" escapes the allowed workspace root "${root}".`);
}

export function resolveProjectPath(projectPath, allowedRoot = defaultAllowedRoot) {
  const normalizedRoot = resolve(allowedRoot);
  const candidatePath = resolve(normalizedRoot, projectPath || '.');

  if (isOutside(normalizedRoot, candidatePath)) {
    throw escapeError(projectPath, normalizedRoot);
  }

  // Lexical containment is not enough: a symlink or junction inside the root
  // can point anywhere. Compare canonical paths so the root itself may live
  // behind a symlink while links that leave it are rejected.
  const realRoot = realpathOfNearestExisting(normalizedRoot);
  const realCandidate = realpathOfNearestExisting(candidatePath);
  if (isOutside(realRoot, realCandidate)) {
    throw escapeError(projectPath, normalizedRoot);
  }

  return realCandidate;
}

export async function runNpmAudit(projectPath) {
  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
      cwd: projectPath,
      maxBuffer: 10 * 1024 * 1024
    });

    return stdout ? JSON.parse(stdout) : {};
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? '';
    if (stdout) {
      try {
        return JSON.parse(stdout);
      } catch {
        return { error: 'Failed to parse npm audit output', raw: stdout };
      }
    }

    return { error: error.message };
  }
}

function summarizeAudit(auditResult) {
  const vulnerabilities = auditResult?.metadata?.vulnerabilities ?? {};
  const total = Object.values(vulnerabilities).reduce(
    (sum, value) => (typeof value === 'number' ? sum + value : sum),
    0
  );

  return {
    total,
    critical: vulnerabilities.critical ?? 0,
    high: vulnerabilities.high ?? 0,
    moderate: vulnerabilities.moderate ?? 0,
    low: vulnerabilities.low ?? 0,
    info: vulnerabilities.info ?? 0
  };
}

export function getPackageInfo(projectPath, allowedRoot = defaultAllowedRoot) {
  const packageJsonPath = resolve(projectPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { exists: false };
  }

  // package.json itself may be a symlink to a file outside the workspace.
  const realRoot = realpathOfNearestExisting(resolve(allowedRoot));
  if (isOutside(realRoot, realpathSync.native(packageJsonPath))) {
    return { exists: true, invalid: true, reason: 'package.json resolves outside the allowed workspace root' };
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return {
      exists: true,
      name: pkg.name ?? 'unknown',
      version: pkg.version ?? '0.0.0',
      scripts: Object.keys(pkg.scripts ?? {})
    };
  } catch {
    return { exists: true, invalid: true };
  }
}

function asToolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

export function registerHealthTool(server, context = {}) {
  server.tool(
    'health_check',
    'Run npm audit, verify package.json, and return a lightweight project health summary.',
    {
      projectPath: z.string().default('.').describe('Project directory to inspect')
    },
    async ({ projectPath }) => {
      const allowedRoot = context.repoRoot ?? defaultAllowedRoot;
      const resolvedPath = resolveProjectPath(projectPath, allowedRoot);
      const packageInfo = getPackageInfo(resolvedPath, allowedRoot);

      if (!packageInfo.exists) {
        return asToolResult({
          ok: false,
          projectPath: resolvedPath,
          summary: 'package.json not found',
          packageJson: packageInfo
        });
      }

      const auditResult = await runNpmAudit(resolvedPath);
      const vulnerabilitySummary = summarizeAudit(auditResult);
      const score = Math.max(
        0,
        100 - vulnerabilitySummary.critical * 25 - vulnerabilitySummary.high * 10 - vulnerabilitySummary.moderate * 5 - vulnerabilitySummary.low * 2
      );

      return asToolResult({
        ok: true,
        projectPath: resolvedPath,
        summary: score >= 80 ? 'Healthy' : score >= 60 ? 'Needs attention' : 'At risk',
        score,
        packageJson: packageInfo,
        vulnerabilities: vulnerabilitySummary
      });
    }
  );
}
