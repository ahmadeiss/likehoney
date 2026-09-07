/**
 * Shared base ESLint flat configuration for non-Next.js workspaces
 * (apps/api and the internal packages).
 *
 * The Next.js application keeps its own config built on eslint-config-next.
 */
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.d.ts'],
  },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
)
