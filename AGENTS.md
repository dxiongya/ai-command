# AGENTS.md

## Cursor Cloud specific instructions

This is **ai-command** (`aim`), a CLI tool that integrates OpenAI ChatGPT into the terminal. It is a single Node.js/TypeScript package (no microservices, no database, no Docker).

### Quick reference

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Build | `pnpm run build` |
| Dev (watch) | `pnpm run dev` |
| Test | `pnpm run test-only` (vitest — no test files exist yet) |
| Format check | `npx prettier --check "src/**/*.ts"` |
| Run CLI | `node dist/cli.js <command>` (after build) |

### Non-obvious notes

- **Build tool**: The project uses `tsup` (not `tsc`) for building. `tsc --noEmit` has pre-existing type errors; this is expected — tsup handles transpilation fine.
- **Config file**: `tsup.config.ts` uses `publicDir: './src/assets'` to copy `src/assets/config.json` into `dist/`. The CLI reads/writes `dist/config.json` at runtime via `path.resolve(__dirname, './config.json')`. If the config gets corrupted during testing, reset it by copying `src/assets/config.json` to `dist/config.json`.
- **OpenAI API key**: Required for `ask` and `chat` commands. Set via `node dist/cli.js set openai_key <key>` or `OPENAI_KEY` env var. Without a key, the CLI exits with an error. The `ls` and `set` commands work without a key.
- **No test files**: vitest is configured in devDependencies but there are no `*.test.ts` or `*.spec.ts` files. `pnpm run test-only` will exit with code 1 ("No test files found") — this is the expected state.
- **Clipboard**: `clipboardy` needs `xclip` or `xsel` on Linux. The `--no-copy` flag or `aim set auto_copy off` bypasses this. Not a blocker for development.
- **pnpm lockfile**: The lockfile was generated with an older pnpm version. `pnpm install` will emit a warning about lockfile incompatibility and regenerate it — this is harmless.
