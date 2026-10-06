/**
 * OAuth providers each integration can actually sign in with.
 *
 * Outlook/Microsoft sign-in has no authorization-URL step wired up, so it is
 * deliberately absent here (and from the preload types). IPC arguments come
 * from the renderer untyped, so the main process re-checks at runtime and
 * answers with one clear "unsupported" error instead of an ad-hoc throw.
 */
export const OAUTH_PROVIDERS = {
  email: ['gmail'],
  calendar: ['google'],
  contacts: ['google'],
} as const;

export type OAuthDomain = keyof typeof OAUTH_PROVIDERS;
export type EmailOAuthProvider = (typeof OAUTH_PROVIDERS.email)[number];
export type CalendarOAuthProvider = (typeof OAUTH_PROVIDERS.calendar)[number];
export type ContactsOAuthProvider = (typeof OAUTH_PROVIDERS.contacts)[number];

export function assertOAuthProvider<D extends OAuthDomain>(
  domain: D,
  provider: unknown,
): asserts provider is (typeof OAUTH_PROVIDERS)[D][number] {
  const supported: readonly string[] = OAUTH_PROVIDERS[domain];
  if (typeof provider !== 'string' || !supported.includes(provider)) {
    throw new Error(
      `Unsupported ${domain} OAuth provider "${String(provider)}". Supported: ${supported.join(', ')}.`,
    );
  }
}

/** Uniform error for an operation a connected account's provider can't do. */
export function unsupportedOperation(operation: string, provider: string): Error {
  return new Error(`${operation} is not supported for the ${provider} provider.`);
}
