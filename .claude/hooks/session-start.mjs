// SessionStart hook: inject the superpowers intro and ponytail rules.
// (Node, not Python, so it also runs on Windows PCs without python3.)
import fs from 'node:fs'
import path from 'node:path'

const skills = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'skills')

function body(name) {
  try {
    const text = fs.readFileSync(path.join(skills, name, 'SKILL.md'), 'utf8')
    return text.replace(/^---[\s\S]*?---\s*/, '')
  } catch {
    return ''
  }
}

const parts = []

const superpowers = body('using-superpowers')
if (superpowers) {
  parts.push(
    "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'using-superpowers' skill - your introduction " +
      "to using skills. For all other skills, use the 'Skill' tool:**\n\n" +
      superpowers +
      '\n</EXTREMELY_IMPORTANT>',
  )
}

let ponytail = body('ponytail')
if (ponytail) {
  // Keep only the default "full" row of the level table, like the plugin does.
  ponytail = ponytail
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .filter((line) => !/^\|\s*\*\*(lite|ultra)\*\*\s*\|/.test(line))
    .join('\n')
  parts.push('PONYTAIL MODE ACTIVE — level: full\n\n' + ponytail)
}

if (parts.length) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') } }))
}
