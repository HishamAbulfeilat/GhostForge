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
| threshold | Compute personal emissions threshold (avg × 1.1) |
| report | Generate Markdown emission report |
| history | Show last 10 tracked sessions |
| status | Show tracker status and current emissions |
| clean | Remove all tracking data |

## Examples
```bash
ghostforge carbon install                    # First-time setup
ghostforge carbon track npm run build        # Track a build
ghostforge carbon track npx playwright test  # Track test run
ghostforge carbon start "morning-dev"        # Start session
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
