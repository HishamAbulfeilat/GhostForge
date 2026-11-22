/**
 * Git steps of the self-updater, kept free of Electron so they can be tested
 * with node:test against a real temporary repository.
 *
 * Rollback guarantees:
 *  - HEAD is recorded before pulling and restored with `git reset --hard`, so
 *    a pull that succeeded followed by a failed install/build is undone.
 *  - Local changes are stashed under a unique message, and only that stash is
 *    popped. A clean tree creates no stash, so an unrelated older stash is
 *    never applied.
 *  - The pull is `--ff-only`, so it never creates a merge commit.
 */

export type GitRunner = (args: string[]) => Promise<{ stdout: string }>

export interface UpdateSnapshot {
  /** Full sha of HEAD before the update. */
  head: string
  /** Message of the stash holding local changes, or null when the tree was clean. */
  stashMessage: string | null
}

export function uniqueStashMessage(now: Date = new Date(), nonce: string = Math.random().toString(36).slice(2, 10)): string {
  return `ghostforge-auto-update-${now.toISOString().replace(/[:.]/g, '-')}-${nonce}`
}

/** Record HEAD and stash local changes (tracked and untracked) under a unique message. */
export async function snapshotBeforeUpdate(git: GitRunner, stashMessage: string = uniqueStashMessage()): Promise<UpdateSnapshot> {
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  if (!/^[0-9a-f]{40,64}$/.test(head)) throw new Error('Could not read the current commit')
  const status = (await git(['status', '--porcelain'])).stdout.trim()
  if (!status) return { head, stashMessage: null }
  await git(['stash', 'push', '--include-untracked', '-m', stashMessage])
  // Confirm the stash really exists before relying on it during rollback.
  const ref = await findStashRef(git, stashMessage)
  return { head, stashMessage: ref ? stashMessage : null }
}

/** The `stash@{n}` ref whose subject ends with exactly `message`, if any. */
export async function findStashRef(git: GitRunner, message: string): Promise<string | null> {
  const list = (await git(['stash', 'list', '--format=%gd%x00%gs'])).stdout
  for (const line of list.split('\n')) {
    const [ref, subject] = line.split('\0')
    if (!ref || subject === undefined) continue
    // Subject is "On <branch>: <message>" (or "WIP on ..." for unnamed stashes).
    if (subject === message || subject.endsWith(`: ${message}`)) return ref.trim()
  }
  return null
}

export async function pullFastForward(git: GitRunner, remote = 'origin', branch = 'main'): Promise<string> {
  return (await git(['pull', '--ff-only', remote, branch])).stdout
}

/**
 * Put the checkout back where `snapshot` found it. Returns the steps taken so
 * the caller can log them. Each step runs even if an earlier one failed; the
 * first error is rethrown at the end.
 */
export async function rollbackUpdate(git: GitRunner, snapshot: UpdateSnapshot): Promise<string[]> {
  const steps: string[] = []
  let firstError: unknown = null
  try {
    await git(['reset', '--hard', snapshot.head])
    steps.push(`reset --hard ${snapshot.head}`)
  } catch (err) {
    firstError = err
  }
  if (snapshot.stashMessage) {
    try {
      const ref = await findStashRef(git, snapshot.stashMessage)
      if (ref) {
        await git(['stash', 'pop', ref])
        steps.push(`stash pop ${ref}`)
      } else {
        steps.push('own stash not found; nothing popped')
      }
    } catch (err) {
      firstError ??= err
    }
  }
  if (firstError) throw firstError
  return steps
}
