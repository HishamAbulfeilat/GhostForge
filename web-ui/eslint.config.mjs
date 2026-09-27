import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

export default [
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'public/**', '**/*.bak', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // Plain .js files here are CommonJS (custom server, runtime helpers, node:test suites)
  { files: ['**/*.js', '**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
]
