# /free-models Command

## Purpose
Configure and use **free AI model providers** alongside GitHub Copilot. Integrate NVIDIA NIM, Groq, Ollama, HuggingFace, Together AI, Cerebras, and OpenRouter into your development workflow.

## Usage
```bash
/free-models                    # Interactive provider setup
/free-models list               # Show all available free providers
/free-models setup nvidia       # Set up NVIDIA NIM
/free-models setup groq         # Set up Groq
/free-models setup ollama       # Set up Ollama (local, no key needed)
/free-models test               # Test all configured connections
/free-models models <provider>  # List available models for a provider
/free-models add-custom         # Add a custom OpenAI-compatible model
```

## Free Model Providers

### 🟢 NVIDIA NIM
- **Free tier**: 1,000 API calls/month
- **Models**: Llama 3.3 70B, Llama 3.1 8B, Mistral 7B, Phi-3, CodeLlama 70B
- **API base**: `https://integrate.api.nvidia.com/v1` (OpenAI-compatible)
- **Sign up**: https://build.nvidia.com
- **Key**: `NVIDIA_API_KEY`

```bash
# In Copilot Chat:
/free-models setup nvidia
# Paste your API key → saved to .env.local
```

### 🟢 Groq (Ultra-fast)
- **Free tier**: Generous rate limits — fastest inference available
- **Models**: Llama 3.1 70B, Llama 3.1 8B instant, Mixtral 8x7B, Gemma2 9B
- **API base**: `https://api.groq.com/openai/v1` (OpenAI-compatible)
- **Sign up**: https://console.groq.com
- **Key**: `GROQ_API_KEY`

### 🟢 Ollama (Local — No Key Needed)
- **Free**: Completely free, runs on your machine
- **Recommended on a 24GB M4 Pro**: `qwen3.5:9b`
- **Fast profile**: `qwen3.5:4b`
- **Maximum-quality profile**: `qwen3.5:27b` (less memory headroom)
- **API base**: `http://localhost:11434/v1` (OpenAI-compatible)
- **Install**: https://ollama.com

```bash
# Install Ollama
brew install ollama

# Start the server
ollama serve

# Pull a model
ollama pull qwen3.5:9b
ollama pull qwen3.5:4b
ollama pull qwen3.5:27b

# List models
ollama list
```

Enable **Offline mode** in the JARVIS settings to block all cloud providers. Runtime order is the selected Ollama model, the best installed Ollama model, then a running llama.cpp server.

### 🟢 llama.cpp Fallback

```bash
brew install llama.cpp
mkdir -p ~/GhostForge/models
llama-server -m ~/GhostForge/models/your-model.gguf --port 8080
```

Set `LLAMACPP_URL=http://localhost:8080/v1` if the server uses a different host or port.

### 🟢 HuggingFace Inference API
- **Free tier**: Limited requests/hour for hosted models
- **Models**: Phi-3, Gemma 7B, CodeLlama 7B, and thousands more
- **API base**: `https://api-inference.huggingface.co`
- **Sign up**: https://huggingface.co/settings/tokens
- **Key**: `HF_TOKEN`

### 🟡 Together AI ($25 Free Credit)
- **Free credit**: $25 on signup (~millions of tokens)
- **Models**: Llama 3.3 70B Turbo, Mixtral 8x7B
- **API base**: `https://api.together.xyz/v1` (OpenAI-compatible)
- **Sign up**: https://api.together.ai
- **Key**: `TOGETHER_API_KEY`

### 🟢 Cerebras
- **Free tier**: Generous limits, wafer-scale speed
- **Models**: Llama 3.3 70B, Llama 3.1 8B
- **API base**: `https://api.cerebras.ai/v1`
- **Sign up**: https://cloud.cerebras.ai
- **Key**: `CEREBRAS_API_KEY`

### 🟢 OpenRouter (Multiple Free Models)
- **Free models**: Llama 3.2 3B, Gemma 3 12B, Mistral 7B (tagged `:free`)
- **API base**: `https://openrouter.ai/api/v1` (OpenAI-compatible)
- **Sign up**: https://openrouter.ai
- **Key**: `OPENROUTER_API_KEY`

## Adding Custom Models

Any OpenAI-compatible API can be added:
```bash
/free-models add-custom
# Name: My Local Mistral
# API base: http://localhost:8080/v1
# Model ID: mistral-7b-instruct
```

Custom models are saved to `marketplace/custom-models.json`.

## Using Free Models in VS Code

All providers are OpenAI-compatible. Configure in your project:

```typescript
// Example: Using Groq as a supplementary API in your app
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const completion = await groq.chat.completions.create({
  model: 'llama-3.1-70b-versatile',
  messages: [{ role: 'user', content: 'Write a React component for...' }],
});
```

## Environment Variables

Add to `.env.local`:
```bash
# Free model providers (add the ones you use)
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxxxxxx
TOGETHER_API_KEY=xxxxxxxxxxxx
CEREBRAS_API_KEY=xxxxxxxxxxxx
HF_TOKEN=hf_xxxxxxxxxxxx
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
# Ollama: no key needed (localhost)
```

## Using with GitHub Copilot

These models **supplement** GitHub Copilot — use them in your own apps and automation scripts. GitHub Copilot itself uses the models configured via the Copilot Business plan (`/model` command).
