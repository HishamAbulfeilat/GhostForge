# /model — Model Selection & Thinking Effort

## Purpose
Switch AI model and effort level. Copilot auto-selects from your enabled models,
but you can override at any time.

## Usage

```
/model                    — show current model + recommendation for task
/model fast               — claude-haiku-4.5 or gpt-5-mini (low effort)
/model balanced           — claude-sonnet-4.6 or gpt-5.4 (medium effort)
/model deep               — claude-opus-4.8 (high effort)
/model max                — claude-opus-4.8 (max effort, step-by-step)
/model gemini             — gemini-3.1-pro (large context, docs)
/model reset              — return to auto-selection
/model list               — list all your enabled models
```

## Your Enabled Models

### Fast (low effort) — Quick tasks
| Model | Best For |
|-------|----------|
| `claude-haiku-4.5` | Explain, quick edits, short answers |
| `gpt-5-mini` | Commit messages, lint, formatting |
| `gpt-5.4-mini` | Mid-complexity completions |
| `gemini-3.5-flash` | Rapid Q&A, simple tasks |

### Balanced (medium effort) — Standard work
| Model | Best For |
|-------|----------|
| `claude-sonnet-4.6` ⭐ | Features, testing, refactoring, CMS |
| `claude-sonnet-4.5` | Features, add-feature, optimize |
| `gpt-5.4` ⭐ | SQL, APIs, deploy scripts, structured output |
| `gpt-5.5` | Complex generation, multi-step code |
| `gemini-2.5-pro` | Diagrams, multimodal, visual tasks |

### Deep (high/max effort) — Complex tasks
| Model | Best For |
|-------|----------|
| `claude-opus-4.8` 🏆 | Security, architecture, system design |
| `claude-opus-4.7` | Code review, critical bug analysis |
| `claude-opus-4.6` | Architecture planning, CMS complex |
| `claude-opus-4.5` | Heavy analysis, full-stack planning |
| `gemini-3.1-pro` | Large codebase, long doc generation |

## Auto-Selection by Command

```
Auto → fast:
  /explain-error, /lint, /commit, /pr-description, /help, /mock, /i18n

Auto → balanced (claude-sonnet-4.6):
  /add-feature, /scaffold, /optimize, /test, /qa, /onboard, /deploy

Auto → balanced (gpt-5.4):
  /sql, /etl, /report, /release, /upgrade, /env

Auto → deep (claude-opus-4.8):
  /security, /review, act as architect, system design, /setup full project

Auto → deep (claude-opus-4.7):
  /fix-tickets --critical, complex architecture questions
```

## Quick Override Examples

```
# Deep security review
/model deep
/security --full --fix

# Fast explanation
/model fast
Explain what this hook does: [paste code]

# Large codebase analysis
/model gemini
Analyze the full src/ folder and identify architectural issues

# Max effort system design
/model max
Design the full microservices architecture for GhostForge HR platform

# Back to auto
/model reset
```
