#!/usr/bin/env python3
"""SessionStart hook: inject the superpowers intro and ponytail rules."""
import json
import os
import re

skills = os.path.join(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()), ".claude", "skills")


def body(name):
    try:
        with open(os.path.join(skills, name, "SKILL.md"), encoding="utf-8") as f:
            return re.sub(r"^---.*?---\s*", "", f.read(), count=1, flags=re.S)
    except OSError:
        return ""


parts = []

superpowers = body("using-superpowers")
if superpowers:
    parts.append(
        "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n"
        "**Below is the full content of your 'using-superpowers' skill - your introduction "
        "to using skills. For all other skills, use the 'Skill' tool:**\n\n"
        + superpowers + "\n</EXTREMELY_IMPORTANT>"
    )

ponytail = body("ponytail")
if ponytail:
    # Keep only the default "full" row of the level table, like the plugin does.
    ponytail = "\n".join(
        line for line in ponytail.splitlines()
        if not re.match(r"^\|\s*\*\*(lite|ultra)\*\*\s*\|", line)
    )
    parts.append("PONYTAIL MODE ACTIVE — level: full\n\n" + ponytail)

if parts:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": "\n\n".join(parts),
        }
    }, ensure_ascii=False))
