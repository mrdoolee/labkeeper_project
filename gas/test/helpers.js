// Shared test helpers.

// Creates the first admin the way a school does (sheet menu) and logs in.
// Returns { token, user }.
export function createAdmin(gas, loginId, name, password) {
  gas.ctx.sheetCreateAdmin({ loginId, name, password })
  const res = gas.call('auth.login', { loginId, password })
  if (!res.ok) throw new Error(res.error.message)
  return res.data
}
