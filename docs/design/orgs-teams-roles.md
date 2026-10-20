# Design: organizations, teams and roles

Status: decisions agreed; ready to break into issues. Issue: #29 (epic #28). Decides #30.

Code references are to the hosted-mode fork (`beriberikix/rootlessRelay`) at
the pinned tag `v0.6.0-hosted.12`. The work lands in the fork; this repo only
bumps the pin and updates the web app and docs.

## Goals

- Organizations own networks, API tokens, usage and (later) billing.
- Members belong to an org with a role; permissions are checked in one place.
- Existing accounts keep working unchanged: each becomes a one-person org.
- Metering, billing, the management API and the dashboard can all key off a
  stable org id.

Non-goals for this epic: billing and plans (#48, #56), the public management
API (#35), per-team networks, SSO/SCIM, custom roles.

## Today (what changes)

| Concern | Now | Where |
|---|---|---|
| Identity | `owner = "user:<id>"` | `auth/tokens.js` `identityForUser` |
| Private network, session caps, address holds | compare `identity.owner` | `policy/session_policy.js`, `server/connection.js` |
| Tier | column on `users` | `policy/tiers.js`, `users.tier` |
| Tokens | `api_tokens.user_id` | `auth/db.js` |
| Usage and quota | `usage_monthly(user_id, month)` | `metering/usage.js` |
| Audit | `connections_audit.owner` (string) | `metering/audit.js` |
| Admission | invite-only signup codes, operator-issued | `auth/invites.js` |
| Operator | `users.role = 'operator'`, global | `admin/app.js` |

## Decisions

**D1. The private network is scoped to the org, not the team.**
Network membership is exactly "same `identity.owner`", so org scope means
`owner = "org:<id>"` and nothing else in the data plane changes. Team-scoped
networks would need a second isolation level inside `session_policy.js`
(address pool, VM-to-VM, holds) for a use case nobody has asked for. Revisit
if one appears.

**D2. Every user has a personal org.**
Created on first sight (and by the migration for existing users). One code
path: everything that owns a resource is an org. `personal = 1` only affects
UI wording and deletion rules; a personal org can still invite members.

**D3. Tier, limits, usage and quota belong to the org.**
Members of an org share its session cap, bandwidth tier and monthly quota.
`users.tier` stays only for operators.

**D4. Tokens belong to an org and carry its identity.**
`api_tokens` gets `org_id` plus the creating user. A session opened with a
token gets `owner = "org:<org_id>"`. Auth0 JWT sessions use the user's
default org unless the client names one (see "Org selection").

**D5. `operator` stays a global user attribute**, separate from org roles.
Operators are not implicitly members of any org; the operator panel acts on
orgs directly.

**D6. Roles are fixed, not configurable.** Five roles, a static permission
matrix in code. Custom roles are out of scope.

**D7. Teams are modelled but deferred.** Without team-scoped resources a team
has no enforcement effect. Phase 2 ships `teams` as member groups that can
own tokens (so removing a person revokes their team's access in one step).
The schema is in this doc so migration 4 does not need redoing.

## Data model

New migration (version 4). Additive: old columns stay, so rolling the relay
back to the previous tag still starts.

```sql
CREATE TABLE orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  personal INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  org_id  INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','billing','read_only')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

CREATE TABLE org_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,                 -- lower-cased
  role TEXT NOT NULL CHECK (role IN ('admin','member','billing','read_only')),
  token_hash TEXT NOT NULL UNIQUE,     -- sha-256, like signup invites
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  revoked_at TEXT
);

-- phase 2
CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (org_id, name)
);
CREATE TABLE team_members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE users      ADD COLUMN default_org_id INTEGER REFERENCES orgs(id);
ALTER TABLE api_tokens ADD COLUMN org_id INTEGER REFERENCES orgs(id);
CREATE TABLE org_usage_monthly (  -- replaces usage_monthly; the old table stays for rollback
  org_id INTEGER NOT NULL, month TEXT NOT NULL,
  bytes_in INTEGER NOT NULL DEFAULT 0, bytes_out INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, month)
);
```

Owner is not inheritable: orgs cannot be left without an owner (see
invariants).

## Roles and permissions

`authorize(principal, action, orgId)` is the only place that reads this
table. `principal` is the authenticated user (or operator); an operator
passes every check except those marked "member-only".

| Action | owner | admin | member | billing | read_only |
|---|:-:|:-:|:-:|:-:|:-:|
| Open sessions with an org token | ✓ | ✓ | ✓ | – | – |
| View org, members, usage, sessions | ✓ | ✓ | ✓ | ✓ (usage only) | ✓ |
| Create own tokens | ✓ | ✓ | ✓ | – | – |
| Revoke own tokens | ✓ | ✓ | ✓ | – | – |
| Revoke any member's token | ✓ | ✓ | – | – | – |
| Close any session | ✓ | ✓ | own only | – | – |
| Invite / remove members | ✓ | ✓ (not owners) | – | – | – |
| Change roles | ✓ | ✓ (not owner roles) | – | – | – |
| Manage teams (phase 2) | ✓ | ✓ | – | – | – |
| View / manage billing (#48) | ✓ | – | – | ✓ | – |
| Rename org | ✓ | ✓ | – | – | – |
| Delete org, transfer ownership | ✓ | – | – | – | – |

A token's effective role is its creator's role at use time, so demoting a
member to `billing` or `read_only` stops their existing tokens from opening
sessions without revoking them.

### Invariants (enforced in the store, covered by tests)

- Every org has at least one owner. Removing, demoting or deleting the last
  owner is refused.
- Admins cannot grant or change `owner`, and cannot modify owners.
- A user cannot change their own role.
- Suspended orgs (operator action) refuse new sessions, and
  `killOwner("org:<id>")` ends live ones.
- Banned users (global) lose access in every org.

## Identity and enforcement

`identityForUser` becomes `identityFor(user, org, role, via)`:

```js
{ kind, owner: `org:${org.id}`, orgId, userId, username,
  tier: org.tier, role, status, via }
```

Everything keyed by `identity.owner` keeps working. Code keyed by `userId`
(`metering/usage.js`, token ownership checks in `server/user_api.js`) is
re-keyed to `orgId`, with `userId` kept for attribution.

Membership and role are looked up on each connection, not carried in the
token. The user lookup already happens per connect (`upsertExternal`,
`touchLogin`), so this adds one indexed read, and role changes take effect on
the next connect (live sessions of a removed member are killed explicitly).

### Org selection

- API token: fixed by `api_tokens.org_id`.
- Auth0 JWT: `users.default_org_id`, overridable per connection with an
  `relay.org.<id>` subprotocol entry, accepted only if the user is a member
  with a role that may open sessions.

### Account API (`/api/me`)

Existing routes keep their shape and act on the default org, so the
dashboard keeps working during the rollout. New routes:

```
GET    /api/me/orgs
POST   /api/orgs                        create an org (operators only in the beta)
GET    /api/orgs/:id
PATCH  /api/orgs/:id
DELETE /api/orgs/:id
GET    /api/orgs/:id/members
PATCH  /api/orgs/:id/members/:userId    role
DELETE /api/orgs/:id/members/:userId
POST   /api/orgs/:id/invites
DELETE /api/orgs/:id/invites/:inviteId
POST   /api/invites/accept              { token }
```

These are the surface the management API epic (#35) will formalize.

## Invitations

Org invites are a separate mechanism from signup invite codes. Signup codes
are an operator-controlled admission gate (`SIGNUP_MODE=invite`); org invites
add an existing or new user to a particular org with a role.

- Email-bound, single-use, expire after 7 days, revocable, token stored as
  SHA-256.
- Accepting requires a signed-in user whose email matches (case-insensitive).
- Accepting does not admit a pending user (see Resolved questions).

## Migration

Runs in the existing migration framework, inside one transaction.

1. Create the new tables.
2. For each user, create a personal org (`name = username`, `personal = 1`,
   `tier = users.tier`) and an `owner` membership; set `default_org_id`.
   Operators get one too.
3. `api_tokens.org_id` = the owner's personal org.
4. Usage moves to a new table, `org_usage_monthly` keyed by `(org_id, month)`,
   backfilled from `usage_monthly` through each user's personal org. The old
   table is not rebuilt: the previous release's `ON CONFLICT(user_id, month)`
   upsert needs its key, so rebuilding would break rollback.
5. `connections_audit` is not rewritten. Old rows keep `owner = "user:<id>"`;
   new rows use `org:<id>`. Audit lookups by org search both forms for orgs
   that were migrated (keeps the abuse-lookup tool working across the cut).

Idempotent, rehearsed on a restored copy of the production database
(`backup-restore-check.yml` already produces one), then staging
(`fly.staging.toml`), then production.

Rollback: deploy the previous tag. The old code ignores the new tables and
columns and keeps working from `user_id`; usage it records lands in the old
`usage_monthly` and does not appear to the new version. Users and tokens the
old release creates have no org; the new release gives them one on first use
(tested).

Live-session cutover: `owner` changes shape, so address holds and the
in-memory registry (both in-process) reset on the deploy restart that happens
anyway. No extra step.

## Deleting accounts

`DELETE /api/me` today removes the user. With orgs:

- The caller's personal org is deleted with them if they are its only member.
- If they are the sole owner of an org that has other members, the delete is
  refused until ownership is transferred or the org is deleted.
- Otherwise the membership is removed and the user is deleted.

## Operator panel

Audit rows are keyed by org, so a connection can no longer be attributed to a
specific member of a shared org. Personal orgs have one member, so nothing is
lost yet; record the user on audit rows before shared orgs ship (tracked as an
issue under #28).

Add an Orgs view: list, tier, suspend/unsuspend, members, tokens. The
existing per-user tier control moves to the org. No new auth surface (private
admin port, SSO unchanged).

## Testing

- Permission matrix as a table-driven test over every role and action.
- Invariant tests: last owner, self-role change, admin vs owner, banned user.
- Migration test on a fixture database that contains operators, pending and
  banned users, tokens with and without expiry, usage in several months.
- Existing suites updated: `auth-store`, `invites`, `metering`,
  `session-policy`, `registry`, `tiers`, `public-server`.
- Network isolation: two members' sessions reach each other; two orgs'
  sessions do not.

## Issue breakdown

| Issue | Content |
|---|---|
| #29 | This doc (decides #30) |
| #31 | Migration 4 schema, `authorize()`, identity change, re-keyed metering, tests |
| #34 | Auth0 `email_verified` claim, org selection on connect, `/api/orgs*` routes, subprotocol |
| #33 | Backfill and rehearsal (can be part of the #31 migration; separate for the runbook) |
| #32 | Org invites, accept flow (needs verified email, #34) |
| new | Operator panel Orgs view |
| new | Phase 2: teams |
| #65 | Dashboard screens and org switcher (dashboard epic #63, after the routes exist) |

## Resolved questions

1. **Org invites do not admit pending users.** During the invite-only beta a
   new user still redeems an operator signup code first; accepting an org
   invite only adds an active user to the org. Revisit when signup opens.
2. **Verified email.** The Auth0 action `add-email-claim` must also emit
   `email_verified`, and the relay must require it before accepting an org
   invite. This is a prerequisite for #32.
3. **Quota is per org** and shared by members, until plans (#56) define
   per-seat limits.
4. **Only operators create additional orgs** during the beta (via the operator
   panel). Users get their personal org automatically; org owners can invite
   but not create orgs.
5. **Dashboard org switcher** is part of #63, not this epic. Until then the
   dashboard acts on the user's default org.

## Open questions

None blocking.
