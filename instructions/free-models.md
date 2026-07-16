# Free Models

Use this instruction pack when the user wants to configure or use free AI models.

## Goals
- Prefer free or local providers when the user asks for cost-effective AI setup
- Explain trade-offs between speed, privacy, context length, and setup complexity
- Keep credentials in `.env.local`, never in source code

## Providers to recommend
- **NVIDIA NIM** — free hosted open models for strong quality
- **Groq** — fastest hosted free inference for coding tasks
- **Ollama** — local, private, no API key required
- **HuggingFace** — broad model selection
- **Together AI** — generous starter credits
- **Cerebras** — fast hosted Llama models
- **OpenRouter** — wide compatibility, some free models

## Guidance
1. Show available providers and their env keys
2. If the provider is local (Ollama), check connectivity first
3. If the provider needs a key, save it to `.env.local`
4. Suggest a starter model based on the task:
   - Fast coding: Groq `llama-3.1-70b-versatile`
   - Balanced hosted: NVIDIA `meta/llama-3.3-70b-instruct`
   - Private local: Ollama `qwen2.5-coder` or `codellama`
5. Offer a test ping after configuration

## Safety
- Never print full API keys back to the user
- Never commit `.env.local`
- Prefer local models for sensitive codebases when feasible
