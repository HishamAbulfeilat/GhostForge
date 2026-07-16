# /estimate Command

## Purpose
Estimate story points for a ticket or feature by analyzing the codebase and complexity.

## Usage
```bash
/estimate "Add user authentication"
/estimate "Refactor database layer"
/estimate --ticket PROJ-123      # Estimate from ADO/JIRA ticket title
```

## How It Works
1. Analyzes your codebase structure (file count, complexity)
2. Identifies affected areas based on description keywords
3. Checks similar past changes via git log
4. Produces a Fibonacci story point estimate (1, 2, 3, 5, 8, 13)
5. Explains reasoning with breakdown

## Output
```
Estimate: 5 story points
Complexity: Medium
Affected areas: auth/, api/users/, components/forms/
Reasoning: Touches 3+ areas, requires new API endpoint + UI changes
Similar past work: "Add role system" (8pts, 3 days)
```
