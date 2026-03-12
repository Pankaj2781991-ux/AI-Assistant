# TypeScript Hardening Plan (Electron App)

The project source has been migrated to TypeScript and now compiles to `.build/`.

## Current state

- Runtime source files are `.ts`.
- `npm run build` compiles TS and copies static assets to `.build/`.
- `npm start` launches Electron from compiled output.
- Browser extension should be loaded from `.build/browser-extension/`.

## Next steps (recommended)

1. Remove `// @ts-nocheck` incrementally:
- Completed: preload files, extension scripts, `ui/overlay.ts`, `ui/bubble.ts`.
- Remaining: `ui/panel.ts`, `main.ts`.

2. Add strong shared contracts:
- `types/contracts.ts` for bbox, OCR/UI/DOM elements, guidance payloads, IPC request/response shapes.

3. Add runtime validation:
- Validate model output and IPC payloads (`zod` recommended).
- Normalize/guard bbox and confidence values at boundaries.

4. Raise compiler strictness in stages:
- `noImplicitAny`
- `strictNullChecks`
- full `strict`

5. Add tests around critical reliability logic:
- anchor resolution priority (`DOM > UI tree > OCR`)
- on-screen prompt confidence gating
- overlay dedupe and show/hide behavior

## Smoke checklist after each tightening step

1. `npm run build`
2. `npm start`
3. Analyze flow (`Send`/`N`)
4. On-screen prompts ON/OFF
5. DIY mode
6. Extension DOM map handoff
