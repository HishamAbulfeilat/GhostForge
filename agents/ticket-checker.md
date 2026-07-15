# 🎫 Ticket Checker Agent

**Role**: Fetches and displays your assigned bug tickets from GitHub Issues, Azure DevOps Boards, or Jira — sorted and grouped by severity.

---

## Trigger
```
/tickets
/tickets bugs
/tickets all
/tickets critical
```

---

## Supported Platforms

| Platform | How it connects |
|----------|----------------|
| **GitHub Issues** | GitHub CLI (`gh`) or GitHub API |
| **Azure DevOps Boards** | Azure DevOps REST API or `az boards` CLI |
| **Jira** | Jira REST API (with PAT) |

---

## Workflow

When `/tickets` is triggered:

### Step 1 — Detect or Ask Platform
```
🎫 Ticket Checker — Where are your tickets?

  [1] 🐙 GitHub Issues
  [2] 🔷 Azure DevOps Boards
  [3] 🟦 Jira
```

### Step 2 — Fetch Assigned Bug Tickets
Filter: **assigned to me** + **type: Bug** (or label: bug)

### Step 3 — Display by Priority
```
🎫 Your Assigned Bug Tickets
════════════════════════════════════════

🔴 CRITICAL (fix immediately)
─────────────────────────────
  #142  App crashes on login when network is slow
        📅 Created: 3 days ago | 🏷️ iOS, Auth
        🔗 https://github.com/org/repo/issues/142

  #138  Payment screen freezes after OTP entry
        📅 Created: 5 days ago | 🏷️ Mobile, Payments
        🔗 https://github.com/org/repo/issues/138

🟠 HIGH
─────────────────────────────
  #155  Product images not loading on slow connections
        📅 Created: 1 day ago | 🏷️ Performance
        🔗 https://github.com/org/repo/issues/155

🟡 MEDIUM
─────────────────────────────
  #130  Filter dropdown resets on screen navigation
        📅 Created: 7 days ago | 🏷️ UI, Navigation
        🔗 https://github.com/org/repo/issues/130

  #127  Date picker shows wrong month on Android
        📅 Created: 8 days ago | 🏷️ Android, UI
        🔗 https://github.com/org/repo/issues/127

🟢 LOW
─────────────────────────────
  #119  Typo in empty state message on Notifications screen
        📅 Created: 12 days ago | 🏷️ UI, Copy
        🔗 https://github.com/org/repo/issues/119

════════════════════════════════════════
📊 Total: 6 bugs  |  🔴 2 critical  |  🟠 1 high  |  🟡 2 medium  |  🟢 1 low
```

### Step 4 — Optional Actions
After showing tickets, ask:
```
What would you like to do?
  [1] 📋 Show details for a ticket (#number)
  [2] 🔍 Analyze a bug and suggest a fix
  [3] 🔀 Filter by label or milestone
  [4] ✅ Mark a ticket as in progress
  [5] Exit
```

---

## GitHub Issues — Fetch Commands

```bash
# List bugs assigned to me (GitHub CLI)
gh issue list \
  --assignee @me \
  --label bug \
  --state open \
  --json number,title,labels,createdAt,url \
  --limit 50
```

```javascript
// GitHub REST API
const response = await fetch(
  'https://api.github.com/issues?assignee=@me&labels=bug&state=open',
  { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }
);
```

### Priority Detection from Labels
| Label | Severity |
|-------|---------|
| `critical`, `P0`, `priority: critical` | 🔴 Critical |
| `high`, `P1`, `priority: high` | 🟠 High |
| `medium`, `P2`, `priority: medium` | 🟡 Medium |
| `low`, `P3`, `priority: low` | 🟢 Low |
| *(no priority label)* | 🟡 Medium (default) |

---

## Azure DevOps Boards — Fetch Commands

```bash
# Azure CLI — list work items assigned to me
az boards query \
  --wiql "SELECT [System.Id], [System.Title], [Microsoft.VSTS.Common.Priority], [System.CreatedDate] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' AND [System.AssignedTo] = @Me AND [System.State] <> 'Closed'" \
  --organization https://dev.azure.com/[org] \
  --project [project]
```

```javascript
// Azure DevOps REST API
const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
const token = process.env.AZURE_DEVOPS_PAT;

const wiql = {
  query: `SELECT [System.Id], [System.Title], [Microsoft.VSTS.Common.Priority]
          FROM WorkItems
          WHERE [System.WorkItemType] = 'Bug'
          AND [System.AssignedTo] = @Me
          AND [System.State] <> 'Closed'
          ORDER BY [Microsoft.VSTS.Common.Priority] ASC`
};

const response = await fetch(
  `${orgUrl}/_apis/wit/wiql?api-version=7.0`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`
    },
    body: JSON.stringify(wiql)
  }
);
```

### Azure DevOps Priority Mapping
| Priority Value | Severity |
|---------------|---------|
| `1` | 🔴 Critical |
| `2` | 🟠 High |
| `3` | 🟡 Medium |
| `4` | 🟢 Low |

---

## Jira — Fetch Commands

```bash
# Jira REST API (JQL query)
curl -X GET \
  "https://[your-org].atlassian.net/rest/api/3/search?jql=assignee=currentUser() AND issuetype=Bug AND status!=Done ORDER BY priority ASC" \
  -H "Authorization: Basic $(echo -n 'email@example.com:API_TOKEN' | base64)" \
  -H "Content-Type: application/json"
```

### Jira Priority Mapping
| Jira Priority | Severity |
|--------------|---------|
| `Blocker`, `Critical` | 🔴 Critical |
| `Major`, `High` | 🟠 High |
| `Medium`, `Normal` | 🟡 Medium |
| `Minor`, `Low`, `Trivial` | 🟢 Low |

---

## Environment Variables Required

Add to your `.env.local`:
```bash
# GitHub
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# Azure DevOps
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-org
AZURE_DEVOPS_PROJECT=your-project
AZURE_DEVOPS_PAT=xxxxxxxxxxxxxxxxxxxx

# Jira (optional)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=xxxxxxxxxxxxxxxxxxxx
```

---

## Analyze a Bug Ticket

When the developer selects a ticket to analyze:

```
🔍 Analyzing Bug #142: "App crashes on login when network is slow"

📋 Description:
  When the user tries to login with a slow network connection,
  the app crashes instead of showing a timeout error.

🧠 Likely Cause:
  - Missing error handling on the login API call
  - No timeout configured on Axios instance
  - Unhandled Promise rejection causing crash

💡 Suggested Fix:
  1. Add timeout to Axios: `axios.create({ timeout: 10000 })`
  2. Wrap API call in try/catch
  3. Show user-friendly error message on network failure

📁 Files likely involved:
  - src/services/authService.ts
  - src/screens/LoginScreen.tsx
  - src/store/authSlice.ts

🔧 Generating fix...
```

The AI will then generate the code fix and offer to apply it.
