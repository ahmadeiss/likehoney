import base from '@likehoney/config/eslint/base.mjs'

export default [...base, { ignores: ['dist/**', 'drizzle/**'] }]
