import { sendChunk, sendDone, sendError } from '../utils/sse.js';

async function fileExists(context, path) {
  try {
    await context.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: context.owner,
      repo: context.repo,
      path,
    });
    return true;
  } catch {
    return false;
  }
}

export default async function deployHandler(args, context, res) {
  try {
    sendChunk(res, '🚀 **GhostForge Deployment Guide**\n\n');

    if (!context.owner || !context.repo) {
      sendChunk(res, 'No repository context detected. Here is the generic deployment playbook.\n\n');
    }

    if (context.owner && context.repo) {
      const [hasVercelConfig, hasGitHubWorkflows, hasAzurePipeline, hasDockerfile] = await Promise.all([
        fileExists(context, 'vercel.json'),
        fileExists(context, '.github/workflows'),
        fileExists(context, 'azure-pipelines.yml'),
        fileExists(context, 'Dockerfile'),
      ]);

      sendChunk(res, `### Deployment signals for ${context.owner}/${context.repo}\n\n`);
      sendChunk(res, `- **Vercel config**: ${hasVercelConfig ? 'Detected' : 'Not found'}\n`);
      sendChunk(res, `- **GitHub Actions**: ${hasGitHubWorkflows ? 'Detected' : 'Not found'}\n`);
      sendChunk(res, `- **Azure Pipelines**: ${hasAzurePipeline ? 'Detected' : 'Not found'}\n`);
      sendChunk(res, `- **Dockerfile**: ${hasDockerfile ? 'Detected' : 'Not found'}\n\n`);
    }

    const target = args || 'default';
    sendChunk(res, `### Suggested path (${target})\n\n`);
    sendChunk(res, '1. Confirm environment variables and secrets are configured.\n');
    sendChunk(res, '2. Validate build/test pipelines before rollout.\n');
    sendChunk(res, '3. Deploy through Vercel, GitHub Actions, or Azure based on repository signals.\n');
    sendChunk(res, '4. Verify health checks and smoke tests after release.\n\n');

    sendChunk(res, '> 💡 For a real deployment trigger, keep using the local GhostForge toolkit or your CI/CD pipeline with explicit approvals.');
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to prepare deployment guidance.');
  }
}
