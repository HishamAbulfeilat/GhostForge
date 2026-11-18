/**
 * In-process service calls between API routes.
 *
 * Some routes call another route's handler directly (the GitHub webhook hands
 * its prompt to JARVIS). They must not forge a session cookie for that: a
 * service request is marked here instead, in a WeakMap keyed by the request
 * object. Only code running in this server process can create such a mark, so
 * nothing that arrives over the network can carry one, and no secret or token
 * is put on the request.
 */
import type { GhostUser } from './users'

export type ServiceName = 'webhook'

export interface ServiceIdentity {
  service: ServiceName
  /** A user-shaped identity limited to chat; never a real account. */
  user: GhostUser
}

const marks = new WeakMap<object, ServiceIdentity>()

function serviceUser(service: ServiceName): GhostUser {
  return {
    id: `service:${service}`,
    name: `${service} service`,
    username: `service:${service}`,
    role: 'user',
    passwordHash: '',
    permissions: ['chat'],
    active: true,
    createdAt: new Date(0).toISOString(),
    permissionsAssigned: true,
  }
}

/** Mark `req` as an in-process call from `service`. Returns the same request. */
export function markServiceRequest<T extends object>(req: T, service: ServiceName): T {
  marks.set(req, { service, user: serviceUser(service) })
  return req
}

/** The service identity of an in-process request, or null for any real request. */
export function internalServiceIdentity(req: object): ServiceIdentity | null {
  return marks.get(req) ?? null
}
