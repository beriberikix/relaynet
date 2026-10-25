# Single sign-on (OpenID Connect)

relaynet can sign people in with any OpenID Connect provider, alongside or
instead of relay accounts (username and password). The dashboard does the
standard browser flow (authorization code with PKCE) and sends the
provider's **access token** to the relay, which verifies it against the
provider's keys. Accounts are created in the relay on first sign-in.

## What the provider needs

- **A public client for the dashboard** (single-page application; no client
  secret), with the authorization code flow and PKCE.
- **Redirect URI** and **post-logout redirect URI**: the site's origin
  exactly, with no path or trailing slash, e.g. `https://relay.example.org`.
  Allow the same origin for cross-origin requests (often called *web
  origins*), so the page can call the token endpoint.
- **Access tokens that are JWTs** (signed, RS256 by default), with:
  - an audience (`aud`) the relay checks: `OIDC_AUDIENCE`;
  - a claim holding the user's email address, used as the username
    (`email` unless `OIDC_USERNAME_CLAIM` says otherwise);
  - ideally a claim that is `true` when the provider has verified that
    address (`OIDC_VERIFIED_CLAIM`). With it set, the relay creates no
    account for an unverified address, and org invitations sent to an email
    address can be accepted. Without it, invitations by email cannot be
    accepted; invitations by username still work.
- **Refresh tokens** for the `offline_access` scope, if you want people to
  stay signed in when the access token expires. Without them, they sign in
  again (usually a redirect and straight back).

The dashboard asks for `openid profile email offline_access` and sends the
audience as an `audience` parameter (Auth0 needs it; other providers ignore
it).

## Settings

In `.env` next to `compose.yaml`:

```sh
OIDC_ISSUER=https://id.example.org/realms/main   # exactly the tokens' "iss"
OIDC_CLIENT_ID=relaynet-dashboard
OIDC_AUDIENCE=relaynet                            # the tokens' "aud"
OIDC_JWKS_URL=https://id.example.org/realms/main/protocol/openid-connect/certs
OIDC_USERNAME_CLAIM=email                         # default
OIDC_VERIFIED_CLAIM=email_verified                # recommended
```

then `docker compose up -d`. The sign-in panel gains **Sign in with single
sign-on**. To offer single sign-on only, also set `USER_SIGNUP=false` and
create no password accounts; to remove the password form entirely, set
`USER_PASSWORD_LOGIN: "false"` for the relay in `compose.override.yaml`
(the operator's `admin` password still works in the operator panel).

`OIDC_ISSUER` must match the `iss` claim character for character, including
any trailing slash.

## Checking a token

Sign in, then in the browser console on the dashboard's page:

```js
const k = Object.keys(localStorage).find((k) => k.startsWith("oidc.user:"));
JSON.parse(atob(JSON.parse(localStorage[k]).access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
```

Look for `iss`, `aud`, the username claim and the verified claim. If the
relay refuses the token, its answer is `invalid-jwt` (the token's issuer,
audience or signing key does not match the settings) or `unknown-issuer`
(`OIDC_ISSUER` differs from the token's `iss`); compare them with the
decoded token.

## Providers

### Auth0 (what relaynet.network uses; tested)

- Create an **API** whose identifier is the audience, e.g.
  `https://relay.example.org` (RS256). Allow skipping user consent.
- Create a **Single Page Application**; set Allowed Callback URLs, Allowed
  Logout URLs and Allowed Web Origins to the site's origin; turn on refresh
  token rotation.
- Auth0's access tokens carry no email, so add a post-login **Action** that
  copies it in under a namespaced claim:

  ```js
  exports.onExecutePostLogin = async (event, api) => {
    api.accessToken.setCustomClaim("https://relaynet/email", event.user.email);
    api.accessToken.setCustomClaim("https://relaynet/email_verified", event.user.email_verified === true);
  };
  ```

- Settings:

  ```sh
  OIDC_ISSUER=https://<tenant>.us.auth0.com/
  OIDC_CLIENT_ID=<SPA client id>
  OIDC_AUDIENCE=https://relay.example.org
  OIDC_JWKS_URL=https://<tenant>.us.auth0.com/.well-known/jwks.json
  OIDC_USERNAME_CLAIM=https://relaynet/email
  OIDC_VERIFIED_CLAIM=https://relaynet/email_verified
  ```

On `localhost`, Auth0 shows a consent screen on every sign-in; that is
Auth0's rule for local callbacks, not a misconfiguration.

### Keycloak (not yet tested with relaynet)

- In a realm, create an **OpenID Connect** client with *Client
  authentication* off, *Standard flow* on, PKCE method `S256`, and the
  site's origin as valid redirect URI, valid post-logout redirect URI and
  web origin.
- Add an **Audience** mapper to the client (or a client scope) that puts
  `OIDC_AUDIENCE` into access tokens.
- The `email` scope puts `email` and `email_verified` into access tokens.
- Settings: `OIDC_ISSUER=https://<host>/realms/<realm>`,
  `OIDC_JWKS_URL=https://<host>/realms/<realm>/protocol/openid-connect/certs`,
  `OIDC_VERIFIED_CLAIM=email_verified`.

### Authentik (not yet tested with relaynet)

- Create an **OAuth2/OpenID provider** with client type *Public*, the site's
  origin as redirect URI, and an application using it.
- Access tokens are JWTs whose audience is the client id, so set
  `OIDC_AUDIENCE` to the client id.
- Settings: `OIDC_ISSUER=https://<host>/application/o/<slug>/`,
  `OIDC_JWKS_URL=https://<host>/application/o/<slug>/jwks/`. Check with the
  console snippet above that `email` and `email_verified` are in the access
  token; if not, add them with a scope mapping.

If you get another provider working, a pull request adding its notes here is
welcome.

## The operator panel

The operator panel signs in with a password by default. It can also use
single sign-on (with MFA required), set through the relay's `ADMIN_OIDC_*`
settings and a confidential client; see the
[rootlessRelay README](https://github.com/beriberikix/rootlessRelay). Keep
the panel bound to `127.0.0.1` unless you have set that up.
