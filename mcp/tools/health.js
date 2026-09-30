import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import * as z from 'zod/v4';

const execFileAsync = promisify(execFile);
const defaultAllowedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function resolveProjectPath(projectPath, allowedRoot = defaultAllowedRoot) {
  const normalizedRoot = resolve(allowedRoot);
  const candidatePath = resolve(normalizedRoot, projectPath || '.');
  const relativePath = relative(normalizedRoot, candidatePath);
  const escapesRoot =
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    isAbsolute(relativePath);

  if (escapesRoot) {
    throw new Error(`Project path "${projectPath || '.'}" escapes the allowed workspace root "${normalizedRoot}".`);
  }

  return candidatePath;
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

function getPackageInfo(projectPath) {
  const packageJsonPath = resolve(projectPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { exists: false };
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
      const resolvedPath = resolveProjectPath(projectPath, context.repoRoot ?? defaultAllowedRoot);
      const packageInfo = getPackageInfo(resolvedPath);

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
