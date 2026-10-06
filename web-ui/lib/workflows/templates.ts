export type WorkflowTemplateStepKind = 'agent' | 'skill' | 'command' | 'manual'

export interface WorkflowTemplateStep {
  title: string
  kind: WorkflowTemplateStepKind
  ref: string
  deps: number[]
}

export interface WorkflowTemplate {
  name: string
  goal: string
  steps: WorkflowTemplateStep[]
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    // Uses only steps the bridge runs today (read-only commands + manual), so ▶ Run works end to end.
    name: 'Release readiness check',
    goal: 'Bridge health → release status → human sign-off',
    steps: [
      { title: 'Check bridge health', kind: 'command', ref: 'bridge:health', deps: [] },
      { title: 'Read release status', kind: 'command', ref: 'bridge:release-status', deps: [0] },
      { title: 'Sign off the release', kind: 'manual', ref: 'Review the results and approve the release', deps: [1] },
    ],
  },
  {
    name: 'Ship a feature',
    goal: 'Plan → build → test → review → deploy',
    steps: [
      { title: 'Plan & spec', kind: 'skill', ref: 'superpowers:brainstorming', deps: [] },
      { title: 'Implement', kind: 'agent', ref: 'feature-dev:code-architect', deps: [0] },
      { title: 'Write & run tests', kind: 'skill', ref: 'superpowers:test-driven-development', deps: [1] },
      { title: 'Code review', kind: 'agent', ref: 'ecc:code-reviewer', deps: [2] },
      { title: 'Deploy', kind: 'command', ref: 'npm run build && deploy', deps: [3] },
    ],
  },
  {
    name: 'Fix a bug',
    goal: 'Reproduce → fix → verify → review',
    steps: [
      { title: 'Reproduce as failing test', kind: 'skill', ref: 'superpowers:systematic-debugging', deps: [] },
      { title: 'Fix to green', kind: 'agent', ref: 'ecc:build-error-resolver', deps: [0] },
      { title: 'Review', kind: 'agent', ref: 'ecc:code-reviewer', deps: [1] },
    ],
  },
]

export function templateToWorkflow(template: WorkflowTemplate) {
  return {
    name: template.name,
    goal: template.goal,
    steps: template.steps.map((step, index) => ({
      id: `s${index}`,
      title: step.title,
      kind: step.kind,
      ref: step.ref,
      deps: step.deps.map(dep => `s${dep}`),
    })),
  }
}

export const workflowTemplates = WORKFLOW_TEMPLATES
export const convertTemplateToWorkflow = templateToWorkflow
export const createWorkflowFromTemplate = templateToWorkflow
