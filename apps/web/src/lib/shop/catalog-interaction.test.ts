import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { reserveCatalogFrame } from './catalog-frame'

test('a short last page or loading/error content cannot collapse the catalog frame', () => {
  let frame = { width: 360, height: 2600 }
  for (const height of [400, 0, 80, 2600, 2700, 400]) {
    frame = reserveCatalogFrame(frame, { width: 360, height })
    assert.ok(frame.height >= 2600)
  }
  assert.equal(frame.height, 2700)
  assert.deepEqual(reserveCatalogFrame(frame, { width: 1200, height: 900 }), {
    width: 1200,
    height: 900,
  })
})

test('homepage pagination stays local, has explicit non-submit controls and an immediate click guard', () => {
  const source = readFileSync(
    new URL('../../app/(store)/components/home/featured-products.tsx', import.meta.url),
    'utf8',
  )
  const handler = source.slice(
    source.indexOf('function changePage'),
    source.indexOf('\n  return ('),
  )
  assert.doesNotMatch(handler, /scrollIntoView|scrollTo|router\.|location|history\./)
  assert.match(handler, /pageLock\.current = true/)
  assert.match(handler, /pageLock\.current \|\| pending/)
  assert.equal((source.match(/type="button"[\s\S]*?onClick=\{\(\) => changePage/g) ?? []).length, 2)
})
