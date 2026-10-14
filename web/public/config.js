// Public configuration for the relaynet frontend. Nothing here is secret:
// the Auth0 client id is meant to ship to browsers.
window.RELAYNET_CONFIG = {
  relayUrl: "https://relay.relaynet.network",
  relayWsUrl: "wss://relay.relaynet.network",
  auth0: {
    domain: "jonathanberi.us.auth0.com",
    clientId: "D8OrEtccuAnIumemWVjUMf6wTWhZzwgr",
    audience: "https://relay.relaynet.network",
  },
};
