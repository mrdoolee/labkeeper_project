// Shared test helpers.

// Creates the first admin the way the school does (no web action for it)
// and logs in. Returns { token, user }.
export function createAdmin(gas, loginId, name, password) {
  return gas.ctx.setupCreateAdmin({ loginId, name, password })
}
