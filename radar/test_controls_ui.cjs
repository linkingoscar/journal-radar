const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');

function fixture(file, className) {
  const nodes = new Map();
  class Select {
    constructor() {
      this.options = [];
      this.value = '';
    }
    replaceChildren(...options) {
      this.options = options;
      this.value = options[0]?.value || '';
    }
    add(option) {
      this.options.push(option);
    }
  }
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Select());
    return nodes.get(selector);
  };
  const Class = vm.runInNewContext(
    fs.readFileSync(__dirname + '/web/' + file, 'utf8') + '\n' + className,
    {
      document: { querySelector: $ },
      JournalPersonal: require('./web/personal.js'),
      Option: class {
        constructor(text, value) {
          Object.assign(this, { text, value });
        }
      },
    },
  );
  return { Class, $ };
}

test('zero bookmarks hide collection tools while filtered and unresolved bookmarks retain recovery controls', () => {
  const { Class, $ } = fixture('favorites.js', 'JournalFavorites');
  const state = { saved: {}, folders: [] };
  const view = Object.assign(Object.create(Class.prototype), {
    $,
    state: () => state,
    folder: 'all',
    selected: new Set(),
  });
  view.sync(true, []);
  assert.equal($('#saved-tools').hidden, true);

  state.saved.oldBookmarkWithoutMetadata = true;
  view.sync(true, []);
  assert.equal($('#saved-tools').hidden, false);
  assert.equal($('#saved-batch-actions').hidden, true);
  assert.equal($('#saved-folder').value, 'all');

  state.saved.one = true;
  view.selected.add('one');
  view.sync(true, [{ id: 'one' }]);
  assert.equal($('#cite-saved').hidden, false);
  assert.equal($('#cite-saved').disabled, false);
  assert.equal($('#remove-saved-folder').hidden, true);

  state.folders.push({ id: 'research', name: '研究', articles: ['one'] });
  view.folder = 'research';
  view.sync(true, [{ id: 'one' }]);
  assert.equal($('#remove-saved-folder').hidden, false);

  view.sync(true, []);
  assert.equal(view.selected.size, 0);
  assert.equal($('#cite-saved').hidden, true);
  assert.equal($('#cite-saved').disabled, true);
  assert.equal($('#saved-tools').hidden, false);
});

test('saved filter controls appear only for available queries and a valid selection', () => {
  const { Class, $ } = fixture('filters.js', 'JournalFilters.Manager');
  const state = { queries: {} };
  const view = new Class({ state: () => state });
  view.sync();
  assert.equal($('.saved-query-bar').hidden, true);

  state.queries.one = { name: '每周未读' };
  view.sync();
  assert.equal($('.saved-query-bar').hidden, false);
  assert.equal($('#apply-query').hidden, true);
  view.sync('one');
  assert.equal($('#saved-query').value, 'one');
  assert.equal($('#apply-query').hidden, false);
  assert.equal($('#edit-query').disabled, false);

  view.sync();
  assert.equal($('#saved-query').value, 'one');

  delete state.queries.one;
  view.sync();
  assert.equal($('#saved-query').value, '');
  assert.equal($('.saved-query-bar').hidden, true);
  assert.equal($('#apply-query').disabled, true);
});
