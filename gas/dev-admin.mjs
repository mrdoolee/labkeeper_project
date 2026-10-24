// Fills the running local dev server (npm run dev) with what the sheet menu
// would: school info and a first admin. Works the same on Windows/macOS/Linux.
//   npm run dev:admin            → kim / first-pass-1, 청주중학교 / 김운영
const base = process.env.GAS_DEV_URL || 'http://127.0.0.1:8787/'

async function post(path, body) {
  const res = await fetch(new URL(path, base), { method: 'POST', body: JSON.stringify(body) })
  return res.json()
}

try {
  console.log('학교 정보:', await post('__dev/schoolInfo', { schoolName: '청주중학교', managerName: '김운영' }))
  console.log('첫 계정 (kim / first-pass-1):', await post('__dev/createAdmin', { loginId: 'kim', name: '김운영', password: 'first-pass-1' }))
} catch (err) {
  console.error(`개발 서버(${base})에 연결하지 못했습니다. 다른 터미널에서 "npm run dev"를 먼저 실행하세요.`)
  process.exitCode = 1
}
