# /ticket Command

## Purpose
Turn a Jira or Azure DevOps ticket into an implementation-ready plan and scaffold.

## Usage
```bash
/ticket [TICKET-ID]
```

## Inputs
- Jira ticket ID such as `WEB-142`
- Azure DevOps work item reference such as `AB#4812`

## What AI should do
1. Try to fetch the ticket from configured integrations or available context.
2. If automatic fetch is not available, ask the user to paste the ticket description, acceptance criteria, and attachments.
3. Classify the work as `feature`, `bug`, or `refactor`.
4. Extract the main scope, edge cases, dependencies, and test expectations.
5. Propose a feature branch name using GhostForge conventions.
6. Generate a commit message template.
7. Suggest or scaffold the likely component, page, service, store, route, and test files based on the repository structure.
8. Match existing naming, folder structure, aliases, and test patterns before creating files.

## Output checklist
- **Ticket summary**
- **Work type**: feature, bug, or refactor
- **Branch name**: for example `feature/web-142-user-profile-form`
- **Commit template**: for example `feat(profile): add editable user profile form`
- **Scaffold plan**: files to create or update
- **Test plan**: unit, integration, UI, or E2E coverage to add

## Notes
- If requirements are incomplete, ask for the missing ticket details before scaffolding.
- Prefer minimal scaffolding that matches the current app architecture.
- Use reusable patterns already present in the codebase.
