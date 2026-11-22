import { auditFailure, resolveProjectPath, runNpmAudit } from './health.js';
import * as z from 'zod/v4';

function summarizeAudit(auditResult) {
  const vulnerabilities = auditResult?.metadata?.vulnerabilities ?? {};
  return {
    critical: vulnerabilities.critical ?? 0,
    high: vulnerabilities.high ?? 0,
    moderate: vulnerabilities.moderate ?? 0,
    low: vulnerabilities.low ?? 0,
    info: vulnerabilities.info ?? 0
  };
}

function asToolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

export function buildSecurityReport(resolvedPath, auditResult) {
  const failure = auditFailure(auditResult);
  if (failure) {
    // An audit that did not run says nothing about the project: never "ok".
    return {
      ok: false,
      projectPath: resolvedPath,
      total: null,
      vulnerabilities: null,
      status: 'unknown',
      error: failure
    };
  }

  const vulnerabilities = summarizeAudit(auditResult);
  const total = Object.values(vulnerabilities).reduce((sum, count) => sum + count, 0);
  return {
    ok: true,
    projectPath: resolvedPath,
    total,
    vulnerabilities,
    status: vulnerabilities.critical > 0 ? 'critical' : vulnerabilities.high > 0 ? 'warning' : 'ok'
  };
}

export function registerSecurityTool(server, context = {}) {
  server.tool(
    'security_scan',
    'Run npm audit --json for a project and return vulnerability counts plus a release risk summary.',
    {
      projectPath: z.string().default('.').describe('Project directory to scan')
    },
    async ({ projectPath }) => {
      const resolvedPath = context.repoRoot ? resolveProjectPath(projectPath, context.repoRoot) : resolveProjectPath(projectPath);
      const auditResult = await runNpmAudit(resolvedPath);
      return asToolResult(buildSecurityReport(resolvedPath, auditResult));
    }
  );
}
