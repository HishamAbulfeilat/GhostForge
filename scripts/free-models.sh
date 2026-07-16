#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════╗
# ║   GhostForge AI — Free Models Manager                          ║
# ║   Configure NVIDIA NIM, Groq, Ollama, HuggingFace & more  ║
# ╚═══════════════════════════════════════════════════════════╝
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS_FILE="$GHOSTFORGE_DIR/marketplace/custom-models.json"
ENV_FILE="$GHOSTFORGE_DIR/.env.local"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

divider() { echo -e "${DIM}══════════════════════════════════════════════════════${NC}"; }

header() {
  echo -e "${BLUE}${BOLD}  🆓 Free AI Models Manager${NC}"
  divider
  echo ""
}

check_env() {
  local key="$1"
  local env_value=""
  env_value="$(printenv "$key" 2>/dev/null || true)"
  [[ -n "$env_value" ]] && echo "configured" && return
  if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    echo "configured"
  else
    echo "not-set"
  fi
}

list_providers() {
  header
  echo -e "  ${BOLD}Free Model Providers:${NC}\n"
  
  # NVIDIA NIM
  local nvidia_status; nvidia_status="$(check_env NVIDIA_API_KEY)"
  local nvidia_icon; [[ "$nvidia_status" == "configured" ]] && nvidia_icon="${GREEN}●${NC}" || nvidia_icon="${YELLOW}○${NC}"
  echo -e "  $nvidia_icon ${BOLD}NVIDIA NIM${NC} — Llama 3.3 70B, Mistral 7B, Phi-3, CodeLlama"
  echo -e "    ${DIM}1,000 free calls/month | API key required${NC}"
  echo -e "    ${CYAN}https://build.nvidia.com${NC}"
  echo -e "    ${DIM}Key: NVIDIA_API_KEY $([ "$nvidia_status" = "configured" ] && echo "✓" || echo "(not set)")${NC}"
  echo ""
  
  # Groq
  local groq_status; groq_status="$(check_env GROQ_API_KEY)"
  local groq_icon; [[ "$groq_status" == "configured" ]] && groq_icon="${GREEN}●${NC}" || groq_icon="${YELLOW}○${NC}"
  echo -e "  $groq_icon ${BOLD}Groq${NC} — Llama 3.1 70B, Mixtral 8x7B, Gemma2 (ultra-fast)"
  echo -e "    ${DIM}Generous free tier | Fastest inference available${NC}"
  echo -e "    ${CYAN}https://console.groq.com${NC}"
  echo -e "    ${DIM}Key: GROQ_API_KEY $([ "$groq_status" = "configured" ] && echo "✓" || echo "(not set)")${NC}"
  echo ""
  
  # Ollama
  local ollama_status="offline"
  curl -s --max-time 2 http://localhost:11434/api/version >/dev/null 2>&1 && ollama_status="online"
  local ollama_icon; [[ "$ollama_status" == "online" ]] && ollama_icon="${GREEN}●${NC}" || ollama_icon="${DIM}○${NC}"
  echo -e "  $ollama_icon ${BOLD}Ollama (Local)${NC} — Llama 3.2, Mistral, DeepSeek, Qwen2.5 Coder"
  echo -e "    ${DIM}100% free, 100% private | No API key needed${NC}"
  echo -e "    ${CYAN}https://ollama.com${NC}"
  echo -e "    ${DIM}Status: $ollama_status${NC}"
  echo ""
  
  # HuggingFace
  local hf_status; hf_status="$(check_env HF_TOKEN)"
  local hf_icon; [[ "$hf_status" == "configured" ]] && hf_icon="${GREEN}●${NC}" || hf_icon="${YELLOW}○${NC}"
  echo -e "  $hf_icon ${BOLD}HuggingFace${NC} — Phi-3, Gemma 7B, CodeLlama (thousands of models)"
  echo -e "    ${DIM}Free tier available${NC}"
  echo -e "    ${CYAN}https://huggingface.co/settings/tokens${NC}"
  echo -e "    ${DIM}Key: HF_TOKEN $([ "$hf_status" = "configured" ] && echo "✓" || echo "(not set)")${NC}"
  echo ""
  
  # Cerebras
  local cerebras_status; cerebras_status="$(check_env CEREBRAS_API_KEY)"
  local cerebras_icon; [[ "$cerebras_status" == "configured" ]] && cerebras_icon="${GREEN}●${NC}" || cerebras_icon="${YELLOW}○${NC}"
  echo -e "  $cerebras_icon ${BOLD}Cerebras${NC} — Llama 3.3 70B, Llama 3.1 8B (wafer-scale speed)"
  echo -e "    ${DIM}Free tier | Fastest Llama inference${NC}"
  echo -e "    ${CYAN}https://cloud.cerebras.ai${NC}"
  echo -e "    ${DIM}Key: CEREBRAS_API_KEY $([ "$cerebras_status" = "configured" ] && echo "✓" || echo "(not set)")${NC}"
  echo ""
  
  # OpenRouter
  local or_status; or_status="$(check_env OPENROUTER_API_KEY)"
  local or_icon; [[ "$or_status" == "configured" ]] && or_icon="${GREEN}●${NC}" || or_icon="${YELLOW}○${NC}"
  echo -e "  $or_icon ${BOLD}OpenRouter${NC} — Llama 3.2 (free), Gemma 3 (free), Mistral 7B (free)"
  echo -e "    ${DIM}Multiple free models tagged :free${NC}"
  echo -e "    ${CYAN}https://openrouter.ai${NC}"
  echo -e "    ${DIM}Key: OPENROUTER_API_KEY $([ "$or_status" = "configured" ] && echo "✓" || echo "(not set)")${NC}"
  echo ""
  
  # Together AI
  local ta_status; ta_status="$(check_env TOGETHER_API_KEY)"
  local ta_icon; [[ "$ta_status" == "configured" ]] && ta_icon="${GREEN}●${NC}" || ta_icon="${YELLOW}○${NC}"
  echo -e "  $ta_icon ${BOLD}Together AI${NC} — Llama 3.3 70B Turbo, Mixtral"
  echo -e "    ${DIM}\$25 free credit on signup${NC}"
  echo -e "    ${CYAN}https://api.together.ai${NC}"
  echo -e "    ${DIM}Key: TOGETHER_API_KEY $([ "$ta_status" = "configured" ] && echo "✓" || echo "(not set)")${NC}"
  echo ""
}

save_api_key() {
  local key="$1" value="$2"
  if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
  echo -e "${GREEN}  ✅ ${key} saved to .env.local${NC}"
}

setup_provider() {
  local provider="${1:-}"
  
  if [[ -z "$provider" ]]; then
    header
    echo -e "  ${BOLD}Choose provider to configure:${NC}\n"
    echo -e "  ${GREEN}[1]${NC} NVIDIA NIM"
    echo -e "  ${GREEN}[2]${NC} Groq"
    echo -e "  ${GREEN}[3]${NC} Ollama (Local)"
    echo -e "  ${GREEN}[4]${NC} HuggingFace"
    echo -e "  ${GREEN}[5]${NC} Cerebras"
    echo -e "  ${GREEN}[6]${NC} OpenRouter"
    echo -e "  ${GREEN}[7]${NC} Together AI"
    echo ""
    read -rp "  Choice: " choice
    case "$choice" in
      1) provider="nvidia" ;; 2) provider="groq" ;; 3) provider="ollama" ;;
      4) provider="huggingface" ;; 5) provider="cerebras" ;;
      6) provider="openrouter" ;; 7) provider="together" ;;
      *) echo -e "${YELLOW}Invalid choice${NC}"; exit 1 ;;
    esac
  fi
  
  case "$provider" in
    nvidia|nvidia-nim)
      echo -e "\n${CYAN}${BOLD}  NVIDIA NIM Setup${NC}"
      echo -e "  ${DIM}Sign up at: https://build.nvidia.com${NC}"
      echo -e "  ${DIM}Free models: Llama 3.3 70B, Mistral 7B, Phi-3, CodeLlama${NC}\n"
      read -rp "  Paste your NVIDIA_API_KEY (nvapi-...): " api_key
      [[ -n "$api_key" ]] && save_api_key "NVIDIA_API_KEY" "$api_key"
      ;;
    groq)
      echo -e "\n${CYAN}${BOLD}  Groq Setup${NC}"
      echo -e "  ${DIM}Sign up at: https://console.groq.com${NC}"
      echo -e "  ${DIM}Free models: Llama 3.1 70B, Mixtral, Gemma2${NC}\n"
      read -rp "  Paste your GROQ_API_KEY (gsk_...): " api_key
      [[ -n "$api_key" ]] && save_api_key "GROQ_API_KEY" "$api_key"
      ;;
    ollama)
      echo -e "\n${CYAN}${BOLD}  Ollama Setup (Local)${NC}"
      echo -e "  ${DIM}No API key needed! Runs on your machine.${NC}\n"
      if ! command -v ollama >/dev/null 2>&1; then
        echo -e "  ${YELLOW}Ollama not installed. Install with:${NC}"
        echo -e "  ${CYAN}brew install ollama${NC}  (macOS)"
        echo -e "  ${CYAN}curl -fsSL https://ollama.com/install.sh | sh${NC}  (Linux)"
      else
        echo -e "  ${GREEN}✅ Ollama is installed!${NC}"
        if curl -s --max-time 2 http://localhost:11434/api/version >/dev/null 2>&1; then
          echo -e "  ${GREEN}✅ Ollama server is running${NC}"
          echo -e "\n  ${BOLD}Available models:${NC}"
          ollama list 2>/dev/null || echo -e "  ${DIM}(run: ollama list)${NC}"
          echo ""
          echo -e "  ${DIM}Pull a model: ollama pull llama3.2${NC}"
          echo -e "  ${DIM}Popular coding models:${NC}"
          echo -e "  ${CYAN}ollama pull qwen2.5-coder${NC}"
          echo -e "  ${CYAN}ollama pull deepseek-coder${NC}"
          echo -e "  ${CYAN}ollama pull codellama${NC}"
        else
          echo -e "  ${YELLOW}Ollama server not running. Start with:${NC}"
          echo -e "  ${CYAN}ollama serve${NC}"
        fi
      fi
      ;;
    huggingface|hf)
      echo -e "\n${CYAN}${BOLD}  HuggingFace Setup${NC}"
      echo -e "  ${DIM}Sign up at: https://huggingface.co/settings/tokens${NC}\n"
      read -rp "  Paste your HF_TOKEN (hf_...): " api_key
      [[ -n "$api_key" ]] && save_api_key "HF_TOKEN" "$api_key"
      ;;
    cerebras)
      echo -e "\n${CYAN}${BOLD}  Cerebras Setup${NC}"
      echo -e "  ${DIM}Sign up at: https://cloud.cerebras.ai${NC}"
      echo -e "  ${DIM}Free: Llama 3.3 70B + Llama 3.1 8B${NC}\n"
      read -rp "  Paste your CEREBRAS_API_KEY: " api_key
      [[ -n "$api_key" ]] && save_api_key "CEREBRAS_API_KEY" "$api_key"
      ;;
    openrouter)
      echo -e "\n${CYAN}${BOLD}  OpenRouter Setup${NC}"
      echo -e "  ${DIM}Sign up at: https://openrouter.ai${NC}"
      echo -e "  ${DIM}Free models: Llama 3.2, Gemma 3, Mistral 7B (tagged :free)${NC}\n"
      read -rp "  Paste your OPENROUTER_API_KEY (sk-or-...): " api_key
      [[ -n "$api_key" ]] && save_api_key "OPENROUTER_API_KEY" "$api_key"
      ;;
    together)
      echo -e "\n${CYAN}${BOLD}  Together AI Setup${NC}"
      echo -e "  ${DIM}Sign up at: https://api.together.ai (\$25 free credit)${NC}\n"
      read -rp "  Paste your TOGETHER_API_KEY: " api_key
      [[ -n "$api_key" ]] && save_api_key "TOGETHER_API_KEY" "$api_key"
      ;;
  esac
  echo ""
}

add_custom_model() {
  header
  echo -e "${BLUE}${BOLD}  🤖 Add Custom OpenAI-Compatible Model${NC}\n"
  
  read -rp "  Display name (e.g. 'My Local Mistral'): " model_name
  [[ -z "$model_name" ]] && echo -e "${RED}Name required${NC}" && exit 1
  
  read -rp "  API base URL (e.g. 'http://localhost:8080/v1'): " api_base
  read -rp "  Model ID (e.g. 'mistral-7b-instruct'): " model_id
  read -rp "  API key env var (leave empty if not needed): " env_key
  
  if [[ -z "$api_base" || -z "$model_id" ]]; then
    echo -e "${RED}API base and model ID are required${NC}"
    exit 1
  fi
  
  command -v node >/dev/null 2>&1 && node -e "
const fs = require('fs');
const modelsPath = '$MODELS_FILE';
const data = fs.existsSync(modelsPath) ? JSON.parse(fs.readFileSync(modelsPath, 'utf8')) : { models: [], free_model_providers: [] };
data.models = data.models || [];
data.models.push({ id: '$model_id'.toLowerCase().replace(/[^a-z0-9]/g, '-'), name: '$model_name', api_base: '$api_base', model_id: '$model_id', env_key: '$env_key' || null, addedAt: new Date().toISOString() });
fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2));
console.log('  \x1b[32m✅ Custom model saved to marketplace/custom-models.json\x1b[0m');
" || echo -e "${GREEN}  ✅ Add to marketplace/custom-models.json manually${NC}"
  echo ""
}

test_connections() {
  header
  echo -e "  ${BOLD}Testing connections...${NC}\n"
  
  # Ollama
  if curl -s --max-time 3 http://localhost:11434/api/version >/dev/null 2>&1; then
    echo -e "  ${GREEN}🟢 Ollama${NC} — ${DIM}online at localhost:11434${NC}"
    ollama list 2>/dev/null | head -5 | while read -r line; do echo -e "    ${DIM}$line${NC}"; done
  else
    echo -e "  ${DIM}⚫ Ollama${NC} — ${DIM}offline (run: ollama serve)${NC}"
  fi
  
  # NVIDIA
  local nvidia_key; nvidia_key="${NVIDIA_API_KEY:-$(grep "^NVIDIA_API_KEY=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)}"
  [[ -n "$nvidia_key" ]] && echo -e "  ${GREEN}🟢 NVIDIA NIM${NC} — ${DIM}API key configured ✓${NC}" || echo -e "  ${YELLOW}🟡 NVIDIA NIM${NC} — ${DIM}needs NVIDIA_API_KEY (https://build.nvidia.com)${NC}"
  
  # Groq
  local groq_key; groq_key="${GROQ_API_KEY:-$(grep "^GROQ_API_KEY=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)}"
  [[ -n "$groq_key" ]] && echo -e "  ${GREEN}🟢 Groq${NC} — ${DIM}API key configured ✓${NC}" || echo -e "  ${YELLOW}🟡 Groq${NC} — ${DIM}needs GROQ_API_KEY (https://console.groq.com)${NC}"
  
  # HuggingFace
  local hf_key; hf_key="${HF_TOKEN:-$(grep "^HF_TOKEN=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)}"
  [[ -n "$hf_key" ]] && echo -e "  ${GREEN}🟢 HuggingFace${NC} — ${DIM}token configured ✓${NC}" || echo -e "  ${YELLOW}🟡 HuggingFace${NC} — ${DIM}needs HF_TOKEN${NC}"
  
  # Cerebras
  local cb_key; cb_key="${CEREBRAS_API_KEY:-$(grep "^CEREBRAS_API_KEY=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)}"
  [[ -n "$cb_key" ]] && echo -e "  ${GREEN}🟢 Cerebras${NC} — ${DIM}API key configured ✓${NC}" || echo -e "  ${YELLOW}🟡 Cerebras${NC} — ${DIM}needs CEREBRAS_API_KEY (https://cloud.cerebras.ai)${NC}"
  
  # OpenRouter
  local or_key; or_key="${OPENROUTER_API_KEY:-$(grep "^OPENROUTER_API_KEY=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)}"
  [[ -n "$or_key" ]] && echo -e "  ${GREEN}🟢 OpenRouter${NC} — ${DIM}API key configured ✓${NC}" || echo -e "  ${YELLOW}🟡 OpenRouter${NC} — ${DIM}needs OPENROUTER_API_KEY${NC}"
  
  echo ""
  echo -e "  ${DIM}Run: bash scripts/free-models.sh setup <provider> to configure any provider${NC}\n"
}

show_menu() {
  header
  echo -e "  ${BOLD}Free AI Models:${NC}\n"
  echo -e "  ${GREEN}[1]${NC} List all providers"
  echo -e "  ${GREEN}[2]${NC} Configure a provider"
  echo -e "  ${GREEN}[3]${NC} Add custom model"
  echo -e "  ${GREEN}[4]${NC} Test connections"
  echo -e "  ${GREEN}[q]${NC} Quit"
  echo ""
  read -rp "  Choice: " choice
  case "$choice" in
    1) list_providers ;;
    2) setup_provider ;;
    3) add_custom_model ;;
    4) test_connections ;;
    q|Q) exit 0 ;;
  esac
}

CMD="${1:-menu}"
case "$CMD" in
  list|providers)    list_providers ;;
  setup|configure)   setup_provider "${2:-}" ;;
  add-custom|custom) add_custom_model ;;
  test)              test_connections ;;
  menu|"")           show_menu ;;
  *)
    echo -e "${YELLOW}Usage: bash scripts/free-models.sh [list|setup <provider>|add-custom|test]${NC}"
    ;;
esac
