'use strict';
const JournalLibrary = (() => {
  const KEY = 'journal-radar:library:v1';
  const fixed = {
    hr35: '人力与组织',
    ft50: 'FT50',
    utd24: 'UTD24',
    custom: '我的选刊',
    all: '全部期刊',
  };
  const validIssn = (s) =>
    typeof s === 'string' &&
    /^\d{4}-\d{3}[\dX]$/.test(s) &&
    [...s.replace('-', '')].reduce((n, c, i) => n + (c === 'X' ? 10 : Number(c)) * (8 - i), 0) %
      11 ===
      0;
  function journal(value) {
    if (
      !value ||
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      value.name.length > 500 ||
      !Array.isArray(value.issns) ||
      value.issns.length > 20 ||
      value.issns.some((s) => !validIssn(s))
    )
      throw new Error('备份期刊名称或 ISSN 无效');
    const rss = value.rss_url || null;
    if (rss) {
      if (typeof rss !== 'string') throw new Error('备份 RSS 地址无效');
      const u = new URL(rss);
      if (
        rss.length > 2000 ||
        !['http:', 'https:'].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.hash ||
        /(^|\.)(localhost|local)$/.test(u.hostname) ||
        u.hostname === 'localhost.localdomain' ||
        /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) ||
        /^\[(::1|::|f[cd][\da-f]*:|fe[89ab][\da-f]*:)/i.test(u.hostname)
      )
        throw new Error('备份 RSS 地址无效');
    }
    if (
      typeof value.id !== 'string' ||
      (value.id.startsWith('rss-')
        ? !/^rss-[a-f0-9]{16}$/.test(value.id) || !rss
        : !validIssn(value.id) || !value.issns.includes(value.id))
    )
      throw new Error('备份期刊标识无效');
    return {
      id: value.id,
      name: value.name.trim(),
      short_name: value.name.trim(),
      issns: [...new Set(value.issns)],
      rss_url: rss,
      crossref_enabled: !value.id.startsWith('rss-') && value.crossref_enabled !== false,
      groups: [],
      enabled: true,
    };
  }
  async function validateBackup(value) {
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.journals) ||
      value.journals.length > 2000
    )
      throw new Error('期刊配置备份无效');
    const journals = value.journals.map(journal);
    if (new Set(journals.map((j) => j.id)).size !== journals.length)
      throw new Error('备份期刊标识重复');
    for (const j of journals)
      if (j.id.startsWith('rss-')) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(j.rss_url));
        if (
          j.id !==
          'rss-' +
            [...new Uint8Array(digest)]
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
              .slice(0, 16)
        )
          throw new Error('RSS 标识与来源不匹配');
      }
    const deleted = value.deleted || [];
    if (
      !Array.isArray(deleted) ||
      deleted.length > 100 ||
      deleted.some(
        (id) =>
          typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(id) || Object.hasOwn(fixed, id),
      )
    )
      throw new Error('备份分组删除记录无效');
    return {
      version: 1,
      journals,
      groups: validate(value.groups, new Set(journals.map((j) => j.id))),
      deleted,
    };
  }
  function combineBackup(base, current, incoming) {
    const journals = current.journals.map((j) => ({ ...j })),
      aliases = {};
    for (const j of incoming.journals) {
      const old = journals.find(
        (x) =>
          x.id === j.id ||
          x.issns.some((i) => j.issns.includes(i)) ||
          (j.rss_url && j.rss_url === x.rss_url),
      );
      if (old) aliases[j.id] = old.id;
      else
        journals.push({ ...j, health: [], article_count: 0, status: 'pending', backup_only: true });
    }
    const groups = new Map(
      current.groups.map((g) => [g.id, { ...g, journal_ids: [...g.journal_ids] }]),
    );
    for (const g of incoming.groups) {
      const members = g.journal_ids.map((id) => aliases[id] || id),
        old =
          groups.get(g.id) ||
          [...groups.values()].find((x) => x.name.toLowerCase() === g.name.toLowerCase());
      if (old) old.journal_ids = [...new Set([...old.journal_ids, ...members])];
      else groups.set(g.id, { ...g, journal_ids: [...new Set(members)] });
    }
    for (const g of base)
      if (
        incoming.deleted.includes(g.id) &&
        JSON.stringify(current.groups.find((x) => x.id === g.id)) === JSON.stringify(g) &&
        !incoming.groups.some((x) => x.id === g.id)
      )
        groups.delete(g.id);
    const clean = validate([...groups.values()], new Set(journals.map((j) => j.id)));
    return {
      journals,
      groups: clean,
      deleted: base.filter((g) => !groups.has(g.id)).map((g) => g.id),
      aliases,
    };
  }
  function validate(groups, ids) {
    if (!Array.isArray(groups) || groups.length > 100) throw new Error('最多创建 100 个个人分组。');
    const seen = new Set(),
      names = new Set();
    return groups.map((g) => {
      if (
        !g ||
        typeof g.id !== 'string' ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(g.id) ||
        Object.hasOwn(fixed, g.id) ||
        seen.has(g.id)
      )
        throw new Error('分组标识无效或重复。');
      if (
        typeof g.name !== 'string' ||
        !g.name.trim() ||
        g.name.trim().length > 40 ||
        names.has(g.name.trim().toLowerCase())
      )
        throw new Error('分组名称不能为空、重复或超过 40 字。');
      if (!Array.isArray(g.journal_ids) || g.journal_ids.some((id) => !ids.has(id)))
        throw new Error('分组包含尚未添加的期刊。');
      seen.add(g.id);
      names.add(g.name.trim().toLowerCase());
      return { id: g.id, name: g.name.trim(), journal_ids: [...new Set(g.journal_ids)] };
    });
  }
  function merge(base, local) {
    const groups = new Map(base.map((g) => [g.id, g]));
    for (const g of local.groups || []) groups.set(g.id, g);
    for (const id of local.deleted || []) groups.delete(id);
    return [...groups.values()];
  }
  class Manager {
    constructor(options) {
      this.options = options;
      this.current = [];
      this.local = { groups: [], deleted: [] };
      this.signature = '';
    }
    apply(data) {
      if (!this.options.desktop) {
        try {
          this.local = JSON.parse(localStorage.getItem(KEY)) || { groups: [], deleted: [] };
        } catch {
          this.options.toast('个人分组暂时无法读取，请检查浏览器存储。');
        }
      }
      for (const j of this.local.journals || [])
        if (!data.journals.some((x) => x.id === j.id))
          data.journals.push({
            ...j,
            groups: [],
            health: [],
            article_count: 0,
            status: 'pending',
            backup_only: true,
          });
      const base = data.groups || [];
      this.base = base;
      this.current = this.options.desktop ? base : merge(base, this.local);
      for (const j of data.journals)
        j.groups = [
          ...j.groups.filter((id) => Object.hasOwn(fixed, id)),
          ...this.current.filter((g) => g.journal_ids.includes(j.id)).map((g) => g.id),
        ];
    }
    label(id) {
      return fixed[id] || this.current.find((g) => g.id === id)?.name || id;
    }
    has(id) {
      return Object.hasOwn(fixed, id) || this.current.some((g) => g.id === id);
    }
    sidebar(custom) {
      const data = this.options.data(),
        groups = [
          ...this.current,
          ...['hr35', 'ft50', 'utd24', 'custom', 'all'].map((id) => ({ id, name: fixed[id] })),
        ];
      const counts = groups.map((g) =>
        g.id === 'all'
          ? data.journals.length
          : g.id === 'custom'
            ? data.journals.filter((j) => custom.includes(j.id)).length
            : data.journals.filter((j) => j.groups.includes(g.id)).length,
      );
      const signature = JSON.stringify([groups, counts]);
      if (signature === this.signature) return;
      this.signature = signature;
      const root = document.querySelector('#groups'),
        focused = root.contains(document.activeElement)
          ? document.activeElement.dataset.group
          : null;
      root.replaceChildren();
      groups.forEach((g, index) => {
        const b = document.createElement('button'),
          name = document.createElement('span'),
          count = document.createElement('span');
        b.dataset.group = g.id;
        b.type = 'button';
        name.textContent = g.name;
        count.textContent = counts[index];
        count.className = 'badge';
        if (g.id === 'custom') count.id = 'custom-count';
        if (g.id === 'all') count.id = 'all-count';
        b.append(name, count);
        root.append(b);
        if (g.id === focused) b.focus();
      });
    }
    async request(path, body) {
      const sessionResponse = await fetch('api/session', { cache: 'no-store' });
      if (!sessionResponse.ok) throw new Error('本机组件未连接，请重新打开桌面版。');
      const session = await sessionResponse.json();
      const response = await fetch('api/library/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Radar-Token': session.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作失败，请重试。');
      return result;
    }
    version() {
      return this.options.desktop
        ? this.options.data().library_revision
        : JSON.stringify(this.local);
    }
    async save(groups, version = this.version()) {
      const data = this.options.data(),
        clean = validate(groups, new Set(data.journals.map((j) => j.id)));
      if (this.options.desktop) await this.request('groups', { groups: clean, revision: version });
      else {
        const latest = JSON.parse(localStorage.getItem(KEY)) || { groups: [], deleted: [] };
        if (JSON.stringify(latest) !== version)
          throw new Error('分组已在其他窗口更新，请刷新页面后重试。');
        const next = {
          ...latest,
          groups: clean,
          deleted: (data.groups || [])
            .filter((g) => !clean.some((x) => x.id === g.id))
            .map((g) => g.id),
        };
        localStorage.setItem(KEY, JSON.stringify(next));
        this.local = next;
      }
      await this.options.reload();
    }
    backup() {
      return {
        version: 1,
        // Legacy source registries can contain a misspelled secondary ISSN.
        // Keep the canonical journal ID and every valid alias in portable backups.
        journals: this.options
          .data()
          .journals.map((j) => journal({ ...j, issns: j.issns.filter(validIssn) })),
        groups: this.current,
        deleted: this.options.desktop
          ? this.options.data().library_deleted_groups || []
          : this.local.deleted || [],
      };
    }
    async restore(value) {
      const clean = await validateBackup(value);
      if (this.options.desktop) {
        const result = await this.request('restore', { library: clean, revision: this.version() });
        await this.options.reload();
        return result.journal_aliases;
      }
      const latest = JSON.parse(localStorage.getItem(KEY)) || { groups: [], deleted: [] };
      if (JSON.stringify(latest) !== this.version())
        throw new Error('期刊配置已在其他窗口更新，请刷新后重新导入');
      const merged = combineBackup(
        this.base,
        { journals: this.options.data().journals, groups: this.current },
        clean,
      );
      localStorage.setItem(
        KEY,
        JSON.stringify({
          journals: merged.journals.filter((j) => j.backup_only).map(journal),
          groups: merged.groups,
          deleted: merged.deleted,
        }),
      );
      await this.options.reload();
      return merged.aliases;
    }
    bind() {
      const $ = (s) => document.querySelector(s),
        node = (tag, text) => {
          const e = document.createElement(tag);
          if (text !== undefined) e.textContent = text;
          return e;
        };
      const message = (id, text) => {
        $(id).textContent = text;
      };
      let editing = null,
        editingVersion = null,
        selected = new Set(),
        busy = false,
        lookupNumber = 0;
      const form = $('#group-form'),
        members = $('#group-members');
      const renderMembers = () => {
        const q = $('#group-member-search').value.trim().toLowerCase();
        members.replaceChildren();
        for (const j of this.options
          .data()
          .journals.filter((j) => [j.name, ...j.issns].join(' ').toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name))) {
          const label = node('label'),
            input = node('input');
          input.type = 'checkbox';
          input.value = j.id;
          input.checked = selected.has(j.id);
          input.addEventListener('change', () => {
            input.checked ? selected.add(j.id) : selected.delete(j.id);
            $('#group-selected-count').textContent = `已选 ${selected.size} 本`;
          });
          label.append(input, node('span', j.name));
          members.append(label);
        }
        $('#group-selected-count').textContent = `已选 ${selected.size} 本`;
      };
      const edit = (id) => {
        editingVersion = this.version();
        editing = this.current.find((g) => g.id === id) || null;
        selected = new Set(editing?.journal_ids || []);
        $('#group-name').value = editing?.name || '';
        $('#group-member-search').value = '';
        $('#delete-group').hidden = !editing;
        $('#group-delete-confirm').hidden = true;
        message('#group-message', '');
        renderMembers();
      };
      const refreshList = (id) => {
        const select = $('#group-editor-select');
        select.replaceChildren(new Option('新建分组', ''));
        for (const g of this.current) select.add(new Option(g.name, g.id));
        select.value = id || '';
        edit(id);
      };
      $('#manage-groups').addEventListener('click', () => {
        if (!this.options.data()) {
          this.options.toast('期刊数据正在加载，请稍后重试。');
          return;
        }
        refreshList(this.current[0]?.id);
        $('#group-manager').showModal();
      });
      $('#group-editor-select').addEventListener('change', (e) => edit(e.target.value));
      $('#new-group').addEventListener('click', () => {
        refreshList('');
        $('#group-name').focus();
      });
      $('#group-member-search').addEventListener('input', renderMembers);
      const run = async (action) => {
        if (busy) return;
        busy = true;
        $('#group-controls').disabled = true;
        try {
          await action();
        } catch (error) {
          message('#group-message', error.message);
        } finally {
          busy = false;
          $('#group-controls').disabled = false;
        }
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        run(async () => {
          const updated = {
            id: editing?.id || 'g-' + crypto.randomUUID(),
            name: $('#group-name').value,
            journal_ids: [...selected],
          };
          const groups = editing
            ? this.current.map((g) => (g.id === editing.id ? updated : g))
            : [...this.current, updated];
          await this.save(groups, editingVersion);
          refreshList(updated.id);
          message('#group-message', '已保存分组。');
        });
      });
      $('#delete-group').addEventListener('click', () => {
        $('#group-delete-confirm').hidden = false;
        $('#confirm-delete-group').focus();
      });
      $('#cancel-delete-group').addEventListener('click', () => {
        $('#group-delete-confirm').hidden = true;
        $('#delete-group').focus();
      });
      $('#confirm-delete-group').addEventListener('click', () =>
        run(async () => {
          const id = editing.id;
          await this.save(
            this.current.filter((g) => g.id !== id),
            editingVersion,
          );
          refreshList('');
          message('#group-message', '分组已删除，期刊、文章和收藏已保留。');
        }),
      );
      $('#add-journal').addEventListener('click', () => this.openAdd());
      $('#journal-lookup-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const number = ++lookupNumber;
        $('#lookup-journal').disabled = true;
        $('#journal-candidates').replaceChildren();
        message('#journal-add-message', '正在核对期刊名称和来源…');
        try {
          const result = await this.request('lookup', {
            query: $('#new-journal-query').value,
            rss_url: $('#new-journal-rss').value,
          });
          if (number !== lookupNumber) return;
          message(
            '#journal-add-message',
            result.journals.length
              ? '请选择与目标期刊一致的记录。'
              : '未找到匹配期刊，请改用 ISSN 或 RSS 地址。',
          );
          for (const j of result.journals) {
            const row = node('div'),
              title = node('strong', j.name),
              detail = node(
                'p',
                j.issns.length
                  ? 'ISSN ' + j.issns.join(' / ') + ' · ' + (j.publisher || '')
                  : '仅 RSS 订阅 · 不提供 Crossref 往期目录',
              );
            row.className = 'journal-candidate';
            const existing = this.options
              .data()
              .journals.some(
                (x) =>
                  x.id === j.id ||
                  x.issns.some((id) => j.issns.includes(id)) ||
                  (x.rss_url && x.rss_url === j.rss_url),
              );
            const add = node('button', existing ? '使用已有期刊' : '添加这本期刊');
            add.type = 'button';
            add.className = 'quiet';
            add.addEventListener('click', async () => {
              const buttons = [...$('#journal-candidates').querySelectorAll('button')];
              buttons.forEach((b) => (b.disabled = true));
              try {
                const saved = await this.request('journals', {
                  candidate: j.candidate,
                  group_id: $('#new-journal-group').value,
                  revision: this.options.data().library_revision,
                });
                await this.options.reload();
                message(
                  '#journal-add-message',
                  saved.existing
                    ? '已使用现有期刊，并保存所选分组。'
                    : '期刊已添加，正在后台采集文章。',
                );
                $('#journal-candidates').replaceChildren();
                this.options.toast('期刊已保存。');
              } catch (error) {
                message('#journal-add-message', error.message);
                buttons.forEach((b) => (b.disabled = false));
              }
            });
            row.append(title, detail, add);
            $('#journal-candidates').append(row);
          }
        } catch (error) {
          message('#journal-add-message', error.message);
        } finally {
          $('#lookup-journal').disabled = false;
        }
      });
      $('#journal-add').addEventListener('close', () => {
        lookupNumber++;
      });
      window.addEventListener('storage', (event) => {
        if (!this.options.desktop && (event.key === KEY || event.key === null))
          this.options.reload();
      });
    }
    openAdd() {
      if (!this.options.data()) {
        this.options.toast('期刊数据正在加载，请稍后重试。');
        return;
      }
      const $ = (s) => document.querySelector(s),
        select = $('#new-journal-group');
      select.replaceChildren(new Option('仅加入期刊库', ''));
      for (const g of this.current) select.add(new Option(g.name, g.id));
      if (this.current.some((g) => g.id === this.options.group()))
        select.value = this.options.group();
      $('#journal-lookup-form').hidden = !this.options.desktop;
      $('#journal-add-web').hidden = this.options.desktop;
      $('#journal-candidates').replaceChildren();
      $('#journal-add-message').textContent = '';
      $('#journal-add').showModal();
    }
  }
  return { Manager, validate, merge, journal, validateBackup, combineBackup };
})();
if (typeof module !== 'undefined') module.exports = JournalLibrary;
