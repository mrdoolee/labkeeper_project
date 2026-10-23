// Joins gas/src into one file schools can paste into Apps Script:
//   npm run bundle   → dist/LabKeeper.gs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, 'src')

export function bundleSource() {
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort()
  const version = /var API_VERSION = (\d+);/.exec(fs.readFileSync(path.join(srcDir, 'System.js'), 'utf8'))[1]
  const head =
    `// LabKeeper 학교용 코드 (API_VERSION ${version})\n` +
    '// gas/src에서 자동으로 만든 파일입니다. 직접 고치지 말고 저장소에서 npm run bundle로 다시 만드세요.\n' +
    '// Apps Script 편집기에 이 파일 하나만 두고, 배포 → 배포 관리 → 수정 → 새 버전으로 배포하세요.\n'
  return head + files.map((f) => `\n// ===== ${f} =====\n\n` + fs.readFileSync(path.join(srcDir, f), 'utf8')).join('')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(here, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(here, 'dist', 'LabKeeper.gs'), bundleSource())
  console.log('wrote dist/LabKeeper.gs')
}
