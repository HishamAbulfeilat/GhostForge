# 🤖 AI Integration Agent

**Role**: Expert in AI/ML integration — OpenAI, Azure OpenAI, GitHub Copilot API, LangChain, vector databases, and building AI-powered features.

---

## Capabilities
- Integrate OpenAI / Azure OpenAI APIs (GPT, DALL-E, Whisper, Embeddings)
- Build chat interfaces with streaming responses
- Implement RAG (Retrieval-Augmented Generation) with vector databases
- Prompt engineering and optimization
- AI feature implementation (autocomplete, summarization, classification)
- LangChain / LangGraph workflows
- GitHub Copilot Extensions
- AI cost optimization

---

## OpenAI Integration

### Setup
```typescript
// lib/openai.ts
import OpenAI from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Azure OpenAI
export const azureOpenAI = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { 'api-version': '2024-02-01' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
});
```

### Streaming Chat (Next.js App Router)
```typescript
// app/api/chat/route.ts
import { openai } from '@/lib/openai';
import { OpenAIStream, StreamingTextResponse } from 'ai'; // Vercel AI SDK

export async function POST(req: Request) {
  const { messages } = await req.json();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    stream: true,
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant for GhostForge.',
      },
      ...messages,
    ],
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
```

### Embeddings + Vector Search (RAG)
```typescript
// lib/rag.ts
import { openai } from './openai';
import { PineconeClient } from '@pinecone-database/pinecone'; // or Azure AI Search

// Generate embedding for a query
async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

// Search similar documents
async function searchDocuments(query: string, topK = 5) {
  const embedding = await getEmbedding(query);
  const pinecone = new PineconeClient();
  const index = pinecone.index('ghostforge-docs');

  const results = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true,
  });

  return results.matches;
}

// Full RAG pipeline
export async function askWithContext(question: string): Promise<string> {
  const docs = await searchDocuments(question);
  const context = docs.map(d => d.metadata?.text).join('

');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: `Answer based on this context:
${context}` },
      { role: 'user', content: question },
    ],
  });

  return response.choices[0].message.content ?? '';
}
```

### Function Calling (Tool Use)
```typescript
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_product',
      description: 'Get product details by ID',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'The product UUID' },
        },
        required: ['product_id'],
      },
    },
  },
];

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages,
  tools,
  tool_choice: 'auto',
});
```

---

## AI Features in React Apps

### AI Autocomplete Input
```typescript
// hooks/useAIAutocomplete.ts
import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export function useAIAutocomplete(systemPrompt: string) {
  const [suggestion, setSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const getSuggestion = useDebouncedCallback(async (input: string) => {
    if (!input.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/autocomplete', {
        method: 'POST',
        body: JSON.stringify({ input, systemPrompt }),
      });
      const { suggestion } = await res.json();
      setSuggestion(suggestion);
    } finally {
      setIsLoading(false);
    }
  }, 300);

  return { suggestion, isLoading, getSuggestion };
}
```

---

## Cost Optimization
- Use `gpt-4o-mini` for simple tasks, `gpt-4o` for complex reasoning
- Cache embeddings — don't re-embed the same content
- Implement token counting before sending (tiktoken)
- Set `max_tokens` limits on all calls
- Use streaming for better UX (don't wait for full response)
- Batch embedding requests (up to 2048 inputs per call)

---

## Environment Variables
```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://ghostforge.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o

# Vector DB (choose one)
PINECONE_API_KEY=...
PINECONE_ENVIRONMENT=...
```
