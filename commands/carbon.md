# /carbon

> Green coding monitor — track carbon emissions from your dev sessions, builds, and CI runs. Based on CodeCarbon + CarbonTracker research.

## Usage
```bash
ghostforge carbon <command> [options]
```

## Commands
| Command | Description |
|---|---|
| install | Install Python deps (codecarbon, carbontracker, pandas) |
| start [label] | Start emission tracking for current dev session |
| stop | Stop active tracker |
| track <cmd> | Wrap any command with emission tracking |
| git-track <start\|stop\|log> | Track sessions using `branch@commit` labels and branch summaries |
| throttle <on\|off\|status> | Enable CPU auto-throttle when emissions exceed threshold |
| threshold | Compute personal emissions threshold (avg × 1.1) |
| equiv [kg] | Convert kg CO₂ into car, phone, tree, flight, and LED equivalents |
| leaderboard [reset] | Rank tracked commands/projects by total emissions |
| report | Generate Markdown emission report |
| export [md\|html] | Export rich Markdown/HTML carbon report to `~/.ghostforge/carbon/reports/` |
| live | Open the real-time terminal carbon dashboard |
| budget <set\|status\|week\|reset> | Manage daily and weekly carbon budgets |
| compare-cloud [provider] | Compare local workload CO₂ vs Vercel/GitHub Actions/Netlify/AWS |
| history | Show last 10 tracked sessions |
| status | Show tracker status and current emissions |
| clean | Remove all tracking data |

## Examples
```bash
ghostforge carbon install                    # First-time setup
ghostforge carbon track npm run build        # Track a build
ghostforge carbon track npx playwright test  # Track test run
ghostforge carbon start "morning-dev"        # Start session
ghostforge carbon git-track start            # Auto-label with branch@commit
ghostforge carbon throttle on                # Enable auto-throttle watcher
ghostforge carbon equiv 0.001                # Show CO₂ equivalencies
ghostforge carbon leaderboard                # Top 10 emitters
ghostforge carbon export html                # Save MD + HTML report and open it
ghostforge carbon live                       # Real-time dashboard
ghostforge carbon budget set 0.05 0.35       # Set daily/weekly budget
ghostforge carbon compare-cloud vercel       # Compare local vs cloud
ghostforge carbon stop && ghostforge carbon threshold
ghostforge carbon report                     # Generate report
```

## Background
Built on research by Hisham Abulfeilat (CRP, 2023): *Reducing the Carbon Footprint of Laptops and Workstations*. The CFRS system achieved 7–15% energy reduction by measuring emissions with CodeCarbon and applying dynamic thresholds.

## Requirements
- Python 3.8+
- pip3
- Run `ghostforge carbon install` once to set up dependencies

## Integration
- Runs automatically in `/health-all` scan
- Threshold alerts shown in dashboard
- Emissions added to PR check report
