import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogPages, parseCatalogPage } from './catalog-pagination'

test('invalid URL pages cannot reach the API as negative, fractional or unsafe values', () => {
  for (const value of [null, '', '0', '-2', '1.5', 'NaN', 'Infinity', '2e3', '9007199254740992'])
    assert.equal(parseCatalogPage(value), 1)
  assert.equal(parseCatalogPage('24'), 24)
})
test('pagination remains bounded for large catalogs and includes both edges', () => {
  assert.deepEqual(catalogPages(50, 100), [1, 'gap', 49, 50, 51, 'gap', 100])
  assert.deepEqual(catalogPages(1, 2), [1, 2])
  assert.deepEqual(catalogPages(100, 100), [1, 'gap', 99, 100])
  assert.deepEqual(catalogPages(1, 0), [])
})
