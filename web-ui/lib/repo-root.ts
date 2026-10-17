import fs from 'fs'
import path from 'path'

/**
 * Repository root (the folder that contains web-ui/). `__dirname`-relative
 * resolution only works when this file runs from lib/ (dev/tests); in the
 * Next.js production bundle `__dirname` points into .next/server/..., so also
 * try locations derived from the server's working directory (web-ui/).
 */
export function findRepoRoot(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..'),
    path.resolve(process.cwd(), '..'),
    process.cwd(),
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'web-ui', 'package.json'))) return c
  }
  return candidates[0]
}
