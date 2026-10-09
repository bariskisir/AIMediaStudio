# Repository Guidelines

## Project Structure & Module Organization

AI Media Studio is an Electron desktop app built with Vite, React, and TypeScript.

- `src/main/` contains the Electron main process, IPC wiring, security policies, and native-facing services.
- `src/preload/` exposes the narrowly scoped bridge to the renderer.
- `src/renderer/src/` contains the React UI: pages, components, hooks, Redux store, i18n locales, and SCSS modules.
- `src/shared/` holds types and code used by more than one process.
- `tests/` contains Vitest unit tests, named after the unit under test (for example, `WindowService.test.ts`).
- `build/` contains application icons; `scripts/generate-icons.mjs` generates icon variants.

Use the configured aliases—`@main`, `@shared`, and `@renderer`—instead of long relative imports when they improve clarity.

## Build, Test, and Development Commands

- `npm run dev` starts Vite and Electron for local development.
- `npm run typecheck` checks both main/preload and renderer TypeScript projects.
- `npm run lint` runs Biome on application and test code.
- `npm run format:check` verifies Prettier formatting; `npm run format` applies it.
- `npm test` runs the Vitest suite once; `npm run test:watch` keeps it running.
- `npm run build` type-checks and produces `out/` build output. Use `npm run package:win` or `npm run package:linux` for installers.

Node.js 24 or later is required. Run `npm install` after pulling dependency changes.

## Coding Style & Naming Conventions

Write TypeScript with two-space indentation, LF endings, single quotes, no semicolons, and trailing commas, as enforced by Prettier. Keep React components, services, and types in PascalCase files (for example, `GenerationService.ts`); use camelCase for functions, values, and hooks (`useSettingsActions.ts`). Put component-local styles in matching `*.module.scss` files. Run `npm run lint` and `npm run format:check` before opening a PR.

## Testing Guidelines

Add or update focused Vitest tests in `tests/` for behavior changes, especially IPC, storage, provider, and security logic. Test files use `*.test.ts` and run in Node with the same import aliases as the app. There is no stated coverage threshold; maintain meaningful coverage of changed branches and error paths.

## Commit & Pull Request Guidelines

Use concise, imperative Conventional Commit-style subjects such as `feat: add tray settings` or `fix(providers): trust OS certificates`. Keep commits scoped. PRs should describe the user-visible change and testing performed, link relevant issues, and include screenshots for renderer/UI changes. Do not commit API keys, tokens, logs containing secrets, or generated `out/` and release artifacts.
