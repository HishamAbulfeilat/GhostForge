# Model Selection & Thinking Effort

Copilot auto-selects the best available model for each task.
You can always override manually.

---

## ✅ Your Enabled Models (HishamAbulfeilat)

### 🟦 Anthropic Claude (Best for reasoning & code)
| Model | Speed | Strength |
|-------|-------|----------|
| `claude-opus-4.8` | Slow | 🏆 Best overall — security, architecture, complex tasks |
| `claude-opus-4.7` | Slow | Deep reasoning, system design |
| `claude-opus-4.6` | Slow | Architecture, complex code review |
| `claude-opus-4.5` | Slow | Heavy analysis |
| `claude-sonnet-4.6` | Medium | ⭐ Best balanced — features, code gen, testing |
| `claude-sonnet-4.5` | Medium | Features, refactoring, CMS |
| `claude-haiku-4.5` | Fast | Quick edits, explanations, simple tasks |

### 🟩 OpenAI GPT (Best for structured output)
| Model | Speed | Strength |
|-------|-------|----------|
| `gpt-5.5` | Medium | Strong reasoning, complex generation |
| `gpt-5.4` | Medium | ⭐ Best balanced GPT — SQL, APIs, features |
| `gpt-5.4-mini` | Fast | Code completions, mid-complexity tasks |
| `gpt-5-mini` | Fast | Quick tasks, commit messages, lint |

### 🟥 Google Gemini (Best for large context & analysis)
| Model | Speed | Strength |
|-------|-------|----------|
| `gemini-3.1-pro` | Medium | Long context, docs, large codebase analysis |
| `gemini-2.5-pro` | Medium | Multimodal, architecture diagrams |
| `gemini-3.5-flash` | Fast | Fast completions, quick Q&A |
| `gemini-3-flash` | Fast | Rapid tasks, formatting |

---

## 🎯 Auto-Selection: Task → Model → Effort

| Task / Command | Auto Model | Effort | Why |
|----------------|-----------|--------|-----|
| `/explain-error`, `/help` | `claude-haiku-4.5` | low | Fast, simple explanation |
| `/lint`, `/commit`, `/pr-description` | `gpt-5-mini` | low | Structured text, no reasoning needed |
| `/mock`, `/i18n`, `/env` | `gpt-5.4-mini` | low | Template generation |
| `/scaffold`, `/add-feature` | `claude-sonnet-4.6` | medium | Reliable multi-file code gen |
| `/optimize`, `/refactor` | `claude-sonnet-4.6` | medium | Code transformation |
| `/test`, `/qa` | `claude-sonnet-4.6` | medium | Thorough test coverage |
| `/sql`, `/etl`, `/report` | `gpt-5.4` | medium | Strong structured output |
| `/deploy`, `/release` | `gpt-5.4` | medium | Scripting + config |
| `/onboard`, `/docs` | `gemini-3.1-pro` | medium | Large context, documentation |
| `/diagram`, `/perf` | `gemini-2.5-pro` | medium | Multimodal + visual |
| `/fix-tickets` (low/medium) | `claude-sonnet-4.6` | medium | Reliable bug fixes |
| `/security` | `claude-opus-4.8` | high | Deepest security reasoning |
| `/review` | `claude-opus-4.7` | high | Thorough code review |
| `/fix-tickets` (critical) | `claude-opus-4.7` | high | Critical bug analysis |
| `/setup` (full project) | `claude-opus-4.6` | high | Complex planning |
| `act as architect` + system design | `claude-opus-4.8` | max | Best available reasoning |
| CMS (Sitecore/Sitefinity) | `claude-sonnet-4.6` | high | Domain complexity |

---

## ⚙️ Effort Levels

| Level | Thinking Budget | Use When |
|-------|----------------|----------|
| `low` | Minimal | Quick lookups, simple edits, commit messages |
| `medium` | Standard | Normal feature work, code generation, SQL |
| `high` | Extended | Security, architecture, CMS, critical bugs |
| `max` | Maximum | Full system design, research, complex planning |

---

## 💬 Manual Override Keywords

### Force deep thinking
```
"think step by step..."          → claude-opus-4.8, max effort
"thorough security audit..."     → claude-opus-4.8, high effort
"full architecture review..."    → claude-opus-4.8, max effort
"be comprehensive..."            → bumps effort +1 level
```

### Force fast mode
```
"quick answer..."                → claude-haiku-4.5, low effort
"briefly explain..."             → gpt-5-mini, low effort
"short version..."               → claude-haiku-4.5, low effort
```

### Force specific model
```
"use gemini for this large codebase analysis..."
"use claude-opus for this security review..."
"use gpt-5.5 for this..."
```

---

## 🔧 Per-Project Config (.ghostforge-config.json)

```json
{
  "model": {
    "default": "claude-sonnet-4.6",
    "security": "claude-opus-4.8",
    "architecture": "claude-opus-4.8",
    "quickTasks": "claude-haiku-4.5",
    "sql": "gpt-5.4",
    "docs": "gemini-3.1-pro",
    "effort": {
      "default": "medium",
      "production": "high",
      "quick": "low"
    }
  }
}
```

---

## 🚫 Disabled Models (not available on your plan)

`claude-sonnet-4` · `claude-sonnet-5` · `claude-fable-5` · `claude-opus-4.8-fast`
`gpt-5.6-luna` · `gpt-5.6-sol` · `gpt-5.6-terra`
`xai-grok-code-fast-1` · `mai-code-1-flash` · `kimi-k2.7-code`
