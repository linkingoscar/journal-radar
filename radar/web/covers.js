(function (root) {
  'use strict';
  function records(value = []) {
    if (!Array.isArray(value) || value.length > 2000) throw new Error('封面备份格式无效');
    const seen = new Set();
    let total = 0;
    return value.map((row) => {
      if (
        !row ||
        !/^(\d{4}-\d{3}[\dX]|rss-[a-f0-9]{16})$/.test(row.journal_id || '') ||
        seen.has(row.journal_id) ||
        typeof row.data !== 'string' ||
        row.data.length > 2_800_000 ||
        row.data.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data)
      )
        throw new Error('封面备份格式无效或超过大小限制');
      total += row.data.length;
      if (total > 50e6) throw new Error('封面备份超过 50 MB');
      const raw = atob(row.data),
        header = Uint8Array.from(raw.slice(0, 24), (c) => c.charCodeAt(0));
      if (
        raw.length < 45 ||
        raw.length > 2 * 1024 * 1024 ||
        raw.slice(0, 8) !== '\x89PNG\r\n\x1a\n' ||
        raw.slice(12, 16) !== 'IHDR'
      )
        throw new Error('备份封面不是完整的 PNG 图片');
      const size = new DataView(header.buffer),
        width = size.getUint32(16),
        height = size.getUint32(20);
      if (Math.min(width, height) < 40 || width * height > 16e6)
        throw new Error('备份封面尺寸无效');
      seen.add(row.journal_id);
      return { journal_id: row.journal_id, data: row.data };
    });
  }
  function store() {
    let connection;
    const open = () =>
      (connection ||= new Promise((resolve, reject) => {
        const request = indexedDB.open('journal-radar-manual-covers', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('covers', { keyPath: 'journal_id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          connection = null;
          reject(new Error('无法打开手动封面缓存'));
        };
      }));
    return {
      async all() {
        const db = await open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('covers'),
            request = tx.objectStore('covers').getAll();
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = tx.onabort = () => reject(new Error('无法读取手动封面缓存'));
        });
      },
      async restore(rows) {
        const db = await open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('covers', 'readwrite'),
            covers = tx.objectStore('covers');
          for (const row of rows) {
            const request = covers.get(row.journal_id);
            request.onsuccess = () => {
              if (!request.result) covers.put(row);
            };
          }
          tx.oncomplete = resolve;
          tx.onerror = tx.onabort = () =>
            reject(new Error('手动封面未能保存，请检查浏览器存储空间'));
        });
      },
    };
  }
  function imageURL(journal, covers, catalog) {
    const cached = covers[journal.id]?.url;
    if (covers[journal.id]?.portable && /^data:image\/png;base64,/.test(cached || ''))
      return cached;
    if (/^\/api\/covers\/image\/[a-f0-9]{64}\.png$/.test(cached || '')) return cached;
    const bundled =
      cached ||
      [journal.id, ...(journal.issns || [])].map((id) => catalog[id]?.cover).find(Boolean);
    return /^cover-[\dX-]+\.(png|jpg|jpeg|webp)$/.test(bundled || '') ? bundled : '';
  }
  function description(record) {
    if (record?.manual) return '正在使用手动封面，自动匹配不会覆盖。';
    if (record?.source === 'bundled') return '正在使用内置封面。可上传图片替换。';
    if (record?.status === 'found') return '已自动匹配 · Third Iron · ISSN ' + record.matched_issn;
    if (record?.status === 'missing')
      return '暂未找到封面，7 天后再次打开应用时重试，也可以手动上传。';
    if (record?.status === 'error')
      return '封面来源暂不可用或图片未通过检查，稍后会重试，也可以手动上传。';
    if (record?.status === 'no_issn') return '这本期刊没有可用于匹配的 ISSN，请手动上传封面。';
    return '正在后台匹配封面，可以继续阅读。';
  }
  class Manager {
    constructor(options) {
      this.options = options;
      this.covers = {};
      this.revision = null;
      this.loading = null;
      this.store = store();
    }
    url(journal) {
      return imageURL(journal, this.covers, this.options.catalog);
    }
    async refresh(revision) {
      if (!this.options.desktop) {
        this.covers = Object.fromEntries(
          records(await this.store.all()).map((r) => [
            r.journal_id,
            { manual: true, portable: true, url: 'data:image/png;base64,' + r.data },
          ]),
        );
        this.options.render();
        return;
      }
      if (revision === this.revision) return;
      if (this.loading) return this.loading;
      this.loading = (async () => {
        const response = await fetch('api/covers', { cache: 'no-store' });
        if (!response.ok) throw new Error('无法读取封面，请重新打开本机应用。');
        const result = await response.json();
        this.covers = result.covers;
        this.revision = result.revision;
        this.options.render();
        this.preview();
      })();
      try {
        await this.loading;
      } finally {
        this.loading = null;
      }
    }
    async backup() {
      let rows;
      if (this.options.desktop) {
        const response = await fetch('api/covers/backup', { cache: 'no-store' });
        rows = await response.json();
        if (!response.ok) throw new Error(rows.error || '无法备份手动封面');
      } else rows = await this.store.all();
      const ids = new Set(this.options.data().journals.map((j) => j.id));
      return records(rows.filter((r) => ids.has(r.journal_id)));
    }
    async validate(rows) {
      for (const row of records(rows)) {
        const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
        let image;
        try {
          image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        } catch {
          throw new Error('备份封面无法解码，尚未导入任何数据');
        }
        image.close();
      }
    }
    async restore(rows, aliases = {}) {
      const mapped = [
        ...new Map(
          rows.map((row) => {
            const journal_id = aliases[row.journal_id] || row.journal_id;
            return [journal_id, { ...row, journal_id }];
          }),
        ).values(),
      ];
      if (!mapped.length) return;
      if (this.options.desktop) {
        const session = await fetch('api/session', { cache: 'no-store' });
        if (!session.ok) throw new Error('本机组件未连接');
        const response = await fetch('api/covers/restore', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Radar-Token': (await session.json()).token,
            },
            body: JSON.stringify(mapped),
          }),
          result = await response.json();
        if (!response.ok) throw new Error(result.error || '手动封面未能恢复');
      } else await this.store.restore(mapped);
      if (this.loading) await this.loading.catch(() => {});
      await this.refresh();
    }
    preview() {
      const dialog = document.querySelector('#cover-manager');
      if (!dialog.open) return;
      const journal = this.options
        .data()
        ?.journals.find((j) => j.id === document.querySelector('#cover-journal').value);
      if (!journal) return;
      const image = document.querySelector('#cover-preview');
      const url = this.url(journal);
      image.hidden = !url;
      if (url) image.src = url;
      else image.removeAttribute('src');
      image.alt = journal.name + ' 的封面';
      document.querySelector('#cover-state').textContent = description(this.covers[journal.id]);
    }
    bind() {
      const $ = (selector) => document.querySelector(selector);
      const button = $('#manage-covers');
      button.hidden = !this.options.desktop;
      if (!this.options.desktop) return;
      button.addEventListener('click', () => {
        const select = $('#cover-journal');
        const previous = select.value;
        select.replaceChildren();
        for (const j of [...(this.options.data()?.journals || [])].sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          const option = document.createElement('option');
          option.value = j.id;
          option.textContent = j.name;
          select.append(option);
        }
        if ([...select.options].some((o) => o.value === previous)) select.value = previous;
        $('#cover-message').textContent = '';
        $('#cover-file').value = '';
        $('#cover-manager').showModal();
        this.preview();
        this.refresh().catch((error) => {
          $('#cover-message').textContent = error.message;
        });
      });
      $('#cover-journal').addEventListener('change', () => {
        $('#cover-message').textContent = '';
        $('#cover-file').value = '';
        this.preview();
      });
      $('#cover-preview').addEventListener('error', () => {
        $('#cover-preview').hidden = true;
      });
      $('#cover-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const file = $('#cover-file').files[0];
        if (!file || file.size > 2 * 1024 * 1024) {
          $('#cover-message').textContent = '请选择不超过 2 MB 的 PNG、JPEG 或 WebP 图片。';
          return;
        }
        const id = $('#cover-journal').value;
        $('#cover-controls').disabled = true;
        $('#cover-message').textContent = '正在保存封面…';
        try {
          const session = await fetch('api/session', { cache: 'no-store' });
          if (!session.ok) throw new Error('本机组件未连接，请重新打开应用。');
          const response = await fetch('api/covers/' + encodeURIComponent(id), {
            method: 'POST',
            headers: {
              'X-Radar-Token': (await session.json()).token,
              'Content-Type': 'application/octet-stream',
            },
            body: file,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '封面未能保存，请重试。');
          // Refresh the whole map even if a poll overlapped the upload.
          if (this.loading) await this.loading.catch(() => {});
          await this.refresh();
          $('#cover-file').value = '';
          $('#cover-message').textContent = '封面已保存，之后会一直使用这张图片。';
        } catch (error) {
          $('#cover-message').textContent = error.message;
        } finally {
          $('#cover-controls').disabled = false;
        }
      });
    }
  }
  const api = { imageURL, description, records, store, Manager };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalCovers = api;
})(globalThis);
