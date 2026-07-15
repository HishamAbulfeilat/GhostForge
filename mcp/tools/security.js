import { resolveProjectPath, runNpmAudit } from './health.js';
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

export function registerSecurityTool(server) {
  server.tool(
    'security_scan',
    'Run npm audit --json for a project and return vulnerability counts plus a release risk summary.',
    {
      projectPath: z.string().default('.').describe('Project directory to scan')
    },
    async ({ projectPath }) => {
      const resolvedPath = resolveProjectPath(projectPath);
      const auditResult = await runNpmAudit(resolvedPath);
      const vulnerabilities = summarizeAudit(auditResult);
      const total = Object.values(vulnerabilities).reduce((sum, count) => sum + count, 0);

      return asToolResult({
        projectPath: resolvedPath,
        total,
        vulnerabilities,
        status: vulnerabilities.critical > 0 ? 'critical' : vulnerabilities.high > 0 ? 'warning' : 'ok'
      });
    }
  );
}
