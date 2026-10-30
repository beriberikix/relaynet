# staging

## Overview

Operator helpers for the staging relay. `tmp-operator.js` creates or removes
a temporary operator account directly in a relay SQLite database, for when
the staging operator password is not to hand. It is run inside the relay
machine via `fly ssh console` (see "Reach the staging panel" in the private
operator runbooks).

## Interface

- `tmp-operator.js` (Node, CommonJS):
  - `ACTION=create PW=<password> node tmp-operator.js`: creates user
    `tmp-operator` with role `operator`; prints its id and default org id.
  - `ACTION=remove node tmp-operator.js`: removes `tmp-operator`; prints
    whether it was removed and how many orgs were deleted. Any `ACTION`
    other than `remove` means create.
  - `DB` (default `/data/relay.sqlite`) and `APP_ROOT` (default
    `/app/node_modules/rootlessrelay`) override the container paths.
  - Uses `openDatabase` (`${APP_ROOT}/auth/db`) and `createUserStore`
    (`${APP_ROOT}/auth/users`) from the relay package.

## Invariants

- Create refuses if `tmp-operator` already exists.
- Create requires `PW` of at least 24 characters (`PW.length < 24` is
  rejected).
- Remove refuses a `tmp-operator` user whose role is not `operator`, and is a
  no-op if the user does not exist.
- The password is never printed.
- On any error it prints `FAILED: <message>` and exits 1.

## Side Effects

- Opens the SQLite database at `DB` and runs `db.migrate()` before acting,
  which can apply pending schema migrations.
- Inserts or deletes the `tmp-operator` account (removal can delete orgs it
  owns, as reported by `removeAccount`).

## Verification

No automated tests. Syntax check: `node --check infra/staging/tmp-operator.js`.
`DB` and `APP_ROOT` allow running it against a scratch database copy.
