// Public configuration for the relaynet frontend. Nothing here is secret:
// an OIDC client id is meant to ship to browsers. Deployments replace this
// file (the docker compose image writes it from environment variables).
window.RELAYNET_CONFIG = {
  // The relay's origin. Empty: this page's origin (a proxy serves both).
  relayUrl: "https://relay.relaynet.network",
  // Any OpenID Connect provider (here Auth0), or null for relay accounts
  // only. The audience is what the relay's JWT_AUDIENCE expects.
  oidc: {
    issuer: "https://jonathanberi.us.auth0.com/",
    clientId: "D8OrEtccuAnIumemWVjUMf6wTWhZzwgr",
    audience: "https://relay.relaynet.network",
  },
};
