const test = require('node:test');
const assert = require('node:assert/strict');
const { imageURL } = require('./web/covers.js');

test('local resolved covers take priority, ISSN aliases reuse bundled covers, remote paths are rejected', () => {
  const journal = { id: '0028-0836', issns: ['1476-4687'] };
  const catalog = { '1476-4687': { cover: 'cover-1476-4687.jpg' } };
  const local = '/api/covers/image/' + 'a'.repeat(64) + '.png';
  assert.equal(imageURL(journal, {}, catalog), 'cover-1476-4687.jpg');
  assert.equal(imageURL(journal, { '0028-0836': { url: local } }, catalog), local);
  for (const url of [
    'https://tracker.test/image.png',
    '/api/covers/image/../../library.json',
    'data:image/svg+xml,bad',
  ]) {
    assert.equal(imageURL(journal, { '0028-0836': { url } }, {}), '');
  }
  assert.equal(imageURL({ id: 'rss-abc', issns: [] }, {}, {}), '');
});
