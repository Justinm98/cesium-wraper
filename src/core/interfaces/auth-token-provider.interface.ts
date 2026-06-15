/**
 * Supplies bearer tokens for authenticated REST calls made by the library.
 *
 * Developers implement this against their identity provider (typically
 * Keycloak). The library deliberately does not bundle an OIDC client:
 * token acquisition, refresh, and storage policy belong to the host
 * application, and bundling one would impose a dependency on every consumer.
 */
export interface AuthTokenProvider {
  /**
   * Returns a valid access token. Called before each authenticated request,
   * so implementations are free to refresh expired tokens internally.
   */
  getToken(): Promise<string>;
}
