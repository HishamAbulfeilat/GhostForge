import { sendChunk, sendDone, sendError } from '../utils/sse.js';

function decodeBase64(content = '') {
  return Buffer.from(content, 'base64').toString('utf8');
}

async function getPackageJson(context) {
  if (!context.owner || !context.repo) return '';
  try {
    const response = await context.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: context.owner,
      repo: context.repo,
      path: 'package.json',
    });
    return decodeBase64(response.data.content);
  } catch {
    return '';
  }
}

function detectSignals(packageJsonText) {
  const text = packageJsonText.toLowerCase();
  return {
    hasNext: text.includes('next'),
    hasReact: text.includes('react'),
    hasReactNative: text.includes('react-native'),
    hasTypeScript: text.includes('typescript'),
  };
}

export default async function optimizeHandler(args, context, res) {
  try {
    sendChunk(res, '⚡ **GhostForge Optimization Suggestions**\n\n');

    const packageJsonText = await getPackageJson(context);
    const signals = detectSignals(packageJsonText);

    if (context.owner && context.repo) {
      sendChunk(res, `📦 **Repository**: ${context.owner}/${context.repo}\n\n`);
    }

    if (args.includes('--deps')) {
      sendChunk(res, '### Dependency-focused improvements\n\n');
      sendChunk(res, '- Review stale packages with `npm outdated` locally.\n');
      sendChunk(res, '- Prioritize security patches before feature upgrades.\n');
      sendChunk(res, '- Re-run smoke tests after any major dependency bump.\n\n');
    }

    sendChunk(res, '### Recommended checks\n\n');
    if (signals.hasNext || signals.hasReact) {
      sendChunk(res, '- Audit large client bundles, duplicate packages, and unnecessary re-renders.\n');
    }
    if (signals.hasReactNative) {
      sendChunk(res, '- Inspect Hermes bundle size, image caching, and list virtualization.\n');
    }
    if (signals.hasTypeScript) {
      sendChunk(res, '- Tighten type boundaries and remove `any`-like escape hatches before scaling changes.\n');
    }
    sendChunk(res, '- Profile slow tests and focus on the most expensive suites first.\n');
    sendChunk(res, '- Review CI caching and artifact reuse for faster pipelines.\n\n');

    sendChunk(res, 'For repository-level metrics, run `ghostforge-ai` → **Project Health Check** or `@ghostforge /health` for a quick hosted overview.');
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to generate optimization guidance.');
  }
}
