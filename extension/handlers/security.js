import { sendChunk, sendDone, sendError } from '../utils/sse.js';

function decodeBase64(content = '') {
  return Buffer.from(content, 'base64').toString('utf8');
}

async function getFileIfPresent(context, path) {
  try {
    const response = await context.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: context.owner,
      repo: context.repo,
      path,
    });
    return response.data;
  } catch {
    return null;
  }
}

function detectStack(repoLanguage, packageJsonText) {
  const lower = packageJsonText.toLowerCase();
  const stacks = new Set();

  if (repoLanguage) stacks.add(repoLanguage);
  if (lower.includes('next')) stacks.add('Next.js');
  if (lower.includes('react-native')) stacks.add('React Native');
  if (lower.includes('react')) stacks.add('React');
  if (lower.includes('express')) stacks.add('Express');
  if (lower.includes('nestjs')) stacks.add('NestJS');
  if (lower.includes('typescript')) stacks.add('TypeScript');

  return [...stacks];
}

function stackChecklist(stacks) {
  const items = [];

  if (stacks.some((stack) => ['React', 'Next.js'].includes(stack))) {
    items.push('- Validate XSS defenses, CSP headers, and auth token handling for web routes.');
  }
  if (stacks.includes('React Native')) {
    items.push('- Verify secure storage, deep-link validation, and secrets are not bundled into the app.');
  }
  if (stacks.some((stack) => ['Express', 'NestJS', 'Node.js'].includes(stack))) {
    items.push('- Review input validation, rate limiting, SSRF exposure, and least-privilege API credentials.');
  }
  if (stacks.includes('TypeScript')) {
    items.push('- Keep runtime validation in place; type safety alone does not protect API boundaries.');
  }

  if (!items.length) {
    items.push('- Review the OWASP Top 10, secrets handling, dependency hygiene, and authentication flows.');
  }

  return items.join('\n');
}

export default async function securityHandler(args, context, res) {
  try {
    sendChunk(res, '🔒 **GhostForge Security Review**\n\n');
    sendChunk(res, 'Streaming a hosted security checklist. For full package scanning, run `ghostforge-ai --command security` locally.\n\n');

    if (!context.owner || !context.repo) {
      sendChunk(res, 'ℹ️ Repository context was not detected, so this is a generic checklist.\n\n');
    }

    let repoLanguage = 'Unknown';
    let packageJsonText = '';
    let hasSecurityPolicy = false;

    if (context.owner && context.repo) {
      const [repoResponse, packageJson, rootPolicy, dotGithubPolicy] = await Promise.all([
        context.octokit.request('GET /repos/{owner}/{repo}', {
          owner: context.owner,
          repo: context.repo,
        }),
        getFileIfPresent(context, 'package.json'),
        getFileIfPresent(context, 'SECURITY.md'),
        getFileIfPresent(context, '.github/SECURITY.md'),
      ]);

      repoLanguage = repoResponse.data.language || 'Unknown';
      packageJsonText = packageJson?.content ? decodeBase64(packageJson.content) : '';
      hasSecurityPolicy = Boolean(rootPolicy || dotGithubPolicy);

      sendChunk(res, `📦 **Repository**: ${context.owner}/${context.repo}\n\n`);
      sendChunk(res, `- **Detected language**: ${repoLanguage}\n- **SECURITY.md present**: ${hasSecurityPolicy ? 'Yes' : 'No'}\n\n`);
    }

    const stacks = detectStack(repoLanguage, packageJsonText);

    sendChunk(res, '### OWASP-focused checklist\n\n');
    sendChunk(res, '- Validate authentication, authorization, and session/token storage.\n');
    sendChunk(res, '- Review secrets management (`.env`, Key Vault, GitHub/Vercel secrets).\n');
    sendChunk(res, '- Check dependency freshness and known advisories with `npm audit`.\n');
    sendChunk(res, '- Confirm input validation and output encoding for user-controlled data.\n');
    sendChunk(res, '- Verify secure headers, logging hygiene, and least-privilege integrations.\n\n');

    sendChunk(res, `### Stack-specific checks\n\n${stackChecklist(stacks)}\n\n`);

    if (!hasSecurityPolicy && context.owner && context.repo) {
      sendChunk(res, '> 🟡 Consider adding `SECURITY.md` so responsible disclosure instructions are visible to contributors.\n\n');
    }

    if (args.includes('--fix')) {
      sendChunk(res, '> ⚠️ Auto-fixing security issues is intentionally local-only. Run `ghostforge-ai --command security --fix` after reviewing the repository.\n\n');
    }

    sendChunk(res, 'Follow-up commands: `@ghostforge /health`, `@ghostforge /optimize --deps`, or local `ghostforge-ai` → **Security Audit**.');
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to complete the security review.');
  }
}
