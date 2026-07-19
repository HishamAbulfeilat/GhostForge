# Deploy GhostForge Web UI to Vercel

## Prerequisites
- Node.js 18+
- Vercel account (free at vercel.com)
- An AI API key (OpenRouter free OR Google Gemini free)

## Steps

### 1. Get a free AI key (pick one):
- **OpenRouter** (recommended): https://openrouter.ai/keys → Create key → free models available
- **Google Gemini**: https://aistudio.google.com/app/apikey → Create key → free

### 2. Deploy:
```bash
cd ~/ghostforge/web-ui
npm install
npx vercel login       # login with GitHub
npx vercel --prod      # deploy
```

### 3. Add environment variables in Vercel dashboard:
Go to: vercel.com → your project → Settings → Environment Variables

Required:
- `ACCESS_PIN` = choose any PIN (e.g. 9876)
- `AUTH_SECRET` = any random string (e.g. ghostforge-hisham-2024)

AI (add at least one):
- `OPENROUTER_API_KEY` = sk-or-... (from openrouter.ai)
- `GOOGLE_GENERATIVE_AI_API_KEY` = AIza... (from aistudio.google.com)

### 4. Redeploy after adding env vars:
```bash
npx vercel --prod
```

### 5. Access from any device:
Open `https://your-app.vercel.app` on phone, tablet, or any browser.

## Enable Mac Bridge (optional — for running commands remotely)
```bash
# On your Mac:
bash ~/ghostforge/scripts/bridge.sh start
# Copy the tunnel URL and token shown
# Add to Vercel env vars: WS_BRIDGE_URL + WS_BRIDGE_TOKEN
# Redeploy
```
