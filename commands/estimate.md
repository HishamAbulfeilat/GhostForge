# /estimate Command

## Purpose
Estimate delivery effort for a ticket, bug, feature request, or pasted requirement.

## Usage
| Command | Description |
|---|---|
| `/estimate [ticket description or paste ticket]` | Generate a quick effort estimate |
| `/estimate --detailed [ticket]` | Provide a deeper phase-by-phase breakdown |
| `/estimate --compare [ticket]` | Compare against similar past tickets or related work patterns |

## Examples
```bash
/estimate Add audit trail to admin actions
/estimate --detailed Paste the full Jira ticket here...
/estimate --compare Enable Azure AD SSO for mobile and web
```

## Output format
```text
📊 Effort Estimate

Story Points: 5
Hours: 6-8h
Confidence: 75%

Breakdown:
  Analysis & design:  1h
  Implementation:     4h
  Tests:              1.5h
  PR review/fixes:    0.5h

Complexity factors:
  ⚠️  Touches authentication layer (+1 sp)
  ⚠️  Requires mobile + web changes (+1 sp)
  ✅  Has existing similar component (-0.5 sp)

Risk: Medium — auth changes need extra testing
```

## What AI does
1. Parses the ticket scope, affected platforms, integrations, and acceptance criteria.
2. Detects uncertainty, missing details, and hidden complexity factors.
3. Produces story points, hours, confidence, and a phase-by-phase breakdown.
4. Highlights risks such as auth, payments, production data, mobile parity, or migration work.
5. When `--compare` is used, relates the estimate to similar tickets, modules, or past implementation patterns.
