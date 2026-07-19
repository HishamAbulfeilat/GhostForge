# /ado Command

## Purpose
Integrate with Azure DevOps — list work items, check pipeline status, view releases.

## Usage
```bash
/ado tickets                    # List your assigned work items
/ado pipelines                  # Show latest pipeline runs
/ado releases                   # Show recent release deployments
/ado ticket 12345               # Show details for work item #12345
```

## Setup
Add to `~/ghostforge/.env.local`:
```bash
AZURE_DEVOPS_ORG=your-org-name
AZURE_DEVOPS_PROJECT=your-project
AZURE_DEVOPS_PAT=your-pat-token
```

Create a PAT at: `https://dev.azure.com/{org}/_usersettings/tokens`
Required scopes: Work Items (Read), Build (Read), Code (Read)

## Notes
- Data is cached for 5 minutes to avoid rate limiting
- Works alongside the GitHub dashboard panel
