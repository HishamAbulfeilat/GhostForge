import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'public/**',
      '**/*.bak',
      'next-env.d.ts',
      // Vendored upstream scenes (agent-office, ai-town). vendor/*/NOTICE.md
      // pins each to a specific upstream commit and lists the local deviations,
      // so the rest must stay byte-identical to upstream to keep that diff
      // reviewable — our ruleset (e.g. no-explicit-any against the Colyseus
      // API surface) would otherwise demand edits that break the contract.
      // `next lint` already excluded these by scoping to app/components/lib.
      'vendor/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // Plain .js files here are CommonJS (custom server, runtime helpers, node:test suites)
  { files: ['**/*.js', '**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
]
