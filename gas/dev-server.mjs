// Local stand-in for the deployed Apps Script web app: runs gas/src with
// in-memory fake Google services. Data is lost on restart.
//   node dev-server.mjs   → http://localhost:8787
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { loadGas } from './test/loadGas.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function startDevServer(port = 8787) {
  const gas = loadGas({ realTime: true })
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      // Stand-ins for sheet-menu items (local testing only).
      const menu = { '/__dev/createAdmin': 'sheetCreateAdmin', '/__dev/schoolInfo': 'sheetSetSchoolInfo' }[req.url]
      if (req.method === 'POST' && menu) {
        let reply
        try {
          gas.ctx[menu](JSON.parse(body))
          reply = { ok: true }
        } catch (err) {
          reply = { ok: false, error: { code: err.code || 'INVALID', message: err.message } }
        }
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(reply))
        return
      }
      const out = req.method === 'POST' ? gas.ctx.doPost({ postData: { contents: body } }) : gas.ctx.doGet({})
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }).end(out.getContent())
    })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`
      resolve({ url, gas, close: () => new Promise((done) => server.close(done)) })
    })
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startDevServer(Number(process.env.PORT) || 8787).then(({ url }) => console.log(`LabKeeper dev server: ${url}`))
}
