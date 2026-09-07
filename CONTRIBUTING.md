# Contributing to Like Honey

Thank you for contributing. This repository follows a simple two-developer
workflow that keeps `main` stable while allowing normal collaboration.

## Branching

`main` is the protected trunk. Nobody pushes to `main` directly. All work
happens on short-lived branches named by intent:

| Prefix       | Use for                                  |
| ------------ | ---------------------------------------- |
| `feature/*`  | New approved functionality               |
| `fix/*`      | Bug fixes                                |
| `refactor/*` | Code improvement without behavior change |
| `chore/*`    | Maintenance, tooling, docs               |

## Workflow

1. Pull latest `main`: `git pull`
2. Create a branch: `git checkout -b feature/short-description`
3. Make small, focused changes
4. Run the checks before committing:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm build
   pnpm format:check
   ```
   (Use `pnpm format` to auto-fix formatting.)
5. Commit with a clear message describing the change
6. Push the branch: `git push -u origin feature/short-description`
7. Open a pull request against `main` using the pull request template
8. Address review feedback, re-run checks, push again
9. Maintainer reviews and merges

## Before you submit

- The PR template checklist must be complete.
- No secrets, keys, or connection strings — anywhere.
- UI changes: considered for RTL/LTR and mobile, screenshots attached.
- Inventory changes: no unsafe (read → mutate in memory → write) stock updates.
- Keep the diff focused; do not rewrite unrelated code.

## Standards

- Strict TypeScript, no `any`, no broad suppressions.
- No unnecessary dependencies.
- Premium polish is a requirement.
- Read `AGENTS.md` before making changes.
