#!/usr/bin/env node
// Creates or removes a temporary operator on a relay database, for when the
// operator password for staging is not to hand. Run it inside the machine with
// `fly ssh console` (see "Reach the staging panel" in the operator runbooks, relaynet-private).
//
//   ACTION=create PW=<24+ char password> node tmp-operator.js
//   ACTION=remove node tmp-operator.js
//
// It refuses to overwrite an existing tmp-operator, refuses to remove a user
// that is not an operator, and never prints the password. DB and APP_ROOT
// override the container defaults (used to test it against a scratch copy).
// Creates (action=create) or removes (action=remove) the temporary staging operator.
// Reads PW from the environment for create; never prints it.
const dbPath = process.env.DB || "/data/relay.sqlite";
const root = process.env.APP_ROOT || "/app/node_modules/rootlessrelay";
const { openDatabase } = require(`${root}/auth/db`);
const { createUserStore } = require(`${root}/auth/users`);
const USER = "tmp-operator";
(async () => {
  const db = openDatabase(dbPath);
  await db.migrate();
  const users = createUserStore(db);
  const existing = await users.findByUsername(USER);
  if (process.env.ACTION === "remove") {
    if (!existing) { console.log("no such user; nothing to remove"); }
    else if (existing.role !== "operator") { throw new Error("refusing: not an operator"); }
    else { const r = await users.removeAccount(existing.id); console.log("removed:", r.removed, "orgs deleted:", r.deletedOrgIds.length); }
  } else {
    if (existing) throw new Error("tmp-operator already exists; remove it first");
    if (!process.env.PW || process.env.PW.length < 16) throw new Error("PW missing or too short");
    const u = await users.create({ username: USER, password: process.env.PW, role: "operator" });
    console.log("created operator id", u.id, "default org", u.default_org_id);
  }
  await db.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
