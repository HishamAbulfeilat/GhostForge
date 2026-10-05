import {
  SnapshotOffice,
  bindSnapshotOffice,
  releaseSnapshotOffice,
  type AgentFields,
  type LayoutItem,
} from '../../../../vendor/agent-office/src/snapshot-room'

export type OfficeModel = { agents: AgentFields[]; layout: LayoutItem[] }

/** Loads and starts the scene; resolves to its teardown, or undefined if cancelled first. */
export type OfficeSceneLoader = (isCancelled: () => boolean) => Promise<(() => void) | undefined>

export type OfficeSession = { office: SnapshotOffice; stop: () => void }

/**
 * Creates the snapshot office, binds it for the scene and starts the scene,
 * all in one place, and returns a stop() that tears every part down. Call it
 * from a single effect so React Strict Mode's mount -> unmount -> mount gets a
 * fresh, live office on the second mount instead of reusing a disposed one.
 */
export function startOfficeSession(
  model: OfficeModel,
  loadScene: OfficeSceneLoader,
  onError: (error: unknown) => void,
): OfficeSession {
  const office = new SnapshotOffice()
  office.update(model.agents, model.layout)
  let cancelled = false
  let stopScene: (() => void) | undefined

  loadScene(() => cancelled).then(
    (stop) => {
      if (cancelled) stop?.()
      else stopScene = stop
    },
    (error) => { if (!cancelled) onError(error) },
  )
  // The scene joins asynchronously after preload; bind now so it finds this office.
  bindSnapshotOffice(office)

  return {
    office,
    stop() {
      cancelled = true
      stopScene?.()
      stopScene = undefined
      releaseSnapshotOffice(office)
      office.dispose()
    },
  }
}
