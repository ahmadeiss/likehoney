import base from './eslint/base.mjs'

export default [...base, { ignores: ['.wrangler/**', 'worker-configuration.d.ts'] }]
