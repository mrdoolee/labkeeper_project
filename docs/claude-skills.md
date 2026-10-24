# 프로젝트에 넣은 Claude 스킬

클라우드 세션은 플러그인을 설치하지 않으므로, 아래 세 플러그인의 스킬을 `.claude/skills/`에 직접 복사해 두었다.
저장소로 여는 모든 세션(클라우드·로컬)에서 자동으로 불러온다.

| 플러그인 | 출처 | 복사한 커밋 | 스킬 |
| --- | --- | --- | --- |
| superpowers | https://github.com/obra/superpowers | 2ce8aa1 (v7.0.1) | brainstorming, diagnosing-superpowers, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, writing-skills |
| ponytail | https://github.com/dietrichgebert/ponytail | 09c434a (v5.3.2) | ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review |
| ui-ux-pro-max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | d14efff (v2.15.0) | banner-design, brand, design, design-system, slides, ui-styling, ui-ux-pro-max |

## 원본에서 바꾼 점

- 스킬 안의 `superpowers:<스킬명>` 참조를 `<스킬명>`으로 바꿨다. 플러그인이 아니라 프로젝트 스킬로 불러오기 때문이다.
- ui-ux-pro-max의 검색 스크립트 경로 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/...`를 `$(git rev-parse --show-toplevel)/.claude/skills/...`로 바꿨다.
- ponytail의 상태줄, 작업 보드(band), webhook 기능은 넣지 않았다. 클라우드 세션에서 쓸 수 없다.

## 세션 시작 훅

`.claude/settings.json`에 SessionStart 훅 두 개가 있다. 둘 다 Node로 실행해서 Windows·macOS·Linux PC와 클라우드 세션에서 똑같이 돈다(Python이 필요 없음).

| 파일 | 하는 일 |
|---|---|
| `.claude/hooks/session-start.mjs` | 세션 시작·초기화·압축 때 using-superpowers 안내와 ponytail 규칙(full 단계)을 넣는다. 플러그인 훅을 대신한다 |
| `.claude/hooks/install-deps.mjs` | `gas/`, `web/`에 npm 패키지가 없거나 `package-lock.json`이 바뀌었으면 `npm install`을 한다. 평소에는 바로 끝난다 |

훅을 바꾼 뒤에는 직접 실행해 확인한다: `node .claude/hooks/session-start.mjs`, `node .claude/hooks/install-deps.mjs`

## 업데이트 방법

원본 저장소가 업데이트되면 해당 플러그인의 스킬 폴더를 다시 복사하고, 위 "원본에서 바꾼 점"을 다시 적용한 뒤 이 문서의 커밋 번호를 갱신한다.
