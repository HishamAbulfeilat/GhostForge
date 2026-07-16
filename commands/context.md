# /context Command

## Purpose
Read and understand the current file or component before taking any follow-up action.

## Usage
```bash
/context
```

## What AI should do
1. Resolve the current file path from the editor or active selection.
2. Detect the file type and role in the codebase, such as:
   - Next.js App Router page or layout
   - React component or client component
   - Custom hook
   - API route or server action
   - Service, utility, provider, or context
   - Zustand store or state module
   - Type definition, schema, or config file
3. Read the file before making changes.
4. Summarize the file's purpose, exported members, props or params, and major dependencies.
5. Note how the file connects to nearby modules, routes, stores, queries, or UI flows.
6. Keep that understanding as working context for the next user request.

## Expected output
- **File**: current path
- **Type**: component, hook, service, page, route, store, and so on
- **Purpose**: short summary of what it does
- **Inputs**: props, params, search params, request data, or store actions
- **Dependencies**: important imports and external libraries
- **Follow-up context**: constraints or patterns Copilot should preserve

## Notes
- Works with React and TypeScript projects in general.
- Supports Next.js App Router pages, layouts, route handlers, React components, hooks, API routes, Zustand stores, TanStack Query modules, and similar files.
- Do not change code during `/context` unless the user explicitly asks for a change after the analysis.
