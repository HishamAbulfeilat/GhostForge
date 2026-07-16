# /dashboard Command

## Purpose
Open a real-time terminal dashboard showing your assigned tickets, CI/CD pipeline status, project health scores, releases, health trend charts, and live activity feed — all in one view.

## Usage
```bash
/dashboard
ghostforge-ai dashboard
bash ~/ghostforge-agents/scripts/dashboard.sh
```

## Dashboard Panels

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚡ GHOSTFORGE DEVELOPER DASHBOARD  │  user  │  time  │  [R]efresh  [Q]uit       │
├──────────────────────────┬──────────────────────────┬──────────────────────  ┤
│  📋 MY TICKETS           │  🏗 PIPELINE STATUS       │  📊 HEALTH BAR CHART  │
│  GitHub Issues assigned  │  GitHub Actions last 12   │  Score per project    │
│  to me — scrollable      │  workflow runs            │  bar chart 0–100      │
├──────────────────────────┼──────────────────────────┼──────────────────────  ┤
│  🚀 RELEASES & TAGS      │  📈 HEALTH TREND LINE     │  🔥 ACTIVITY FEED     │
│  Git tags + dates +      │  Health score over        │  Last 20 git commits  │
│  release messages        │  version history          │  with hash + message  │
└──────────────────────────┴──────────────────────────┴──────────────────────  ┘
│  Status bar: last refresh · keyboard hints                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Panels Explained

### 📋 My Tickets
- Fetches GitHub Issues assigned to `@me` via `gh issue list`
- Shows: issue #, title, labels, updated date
- Scrollable table — use arrow keys

### 🏗 Pipeline Status
- Fetches last 12 GitHub Actions workflow runs via `gh run list`
- Icons: ✅ success · ❌ failure · 🔄 in_progress · ⚪ unknown
- Shows: workflow name, branch, conclusion, date

### 📊 Health Bar Chart
- Bar chart of health scores (0–100) per registered project
- Uses cached scores from `/health` runs (`.ghostforge-cache/health.json`)
- Colors: 🟢 ≥90 · 🟡 70–89 · 🟠 50–69 · 🔴 <50

### 🚀 Releases & Tags
- Lists git tags from the toolkit repo
- Shows: tag name, date, release message
- Useful to track version history at a glance

### 📈 Health Score Trend (Line Chart)
- Line chart of health score over version history
- X-axis: version tags (v2.5, v2.6, v2.7…)
- Y-axis: health score (0–100)

### 🔥 Activity Feed
- Live scrolling git log from the toolkit repo
- Last 20 commits with hash and message
- Auto-refreshes every 60 seconds

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `R` | Force refresh all panels |
| `Q` / `Ctrl+C` | Quit dashboard |
| `Tab` | Switch focus between panels |
| `↑↓` | Scroll within focused panel |

## Auto-refresh
Dashboard refreshes automatically every **60 seconds**. Press `R` for an immediate refresh.

## Requirements
- `gh` CLI authenticated (`gh auth login`)
- Node.js 18+
- For ticket data: `gh issue list` scope
- For pipeline data: `gh run list` scope
- Projects must be registered in `.registered-projects` for health scores
