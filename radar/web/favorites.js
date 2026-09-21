'use strict';
class JournalFavorites {
  constructor({ state, persist, render, known, remember, journals, toast }) {
    Object.assign(this, { state, persist, render, known, remember, journals, toast });
    this.folder = 'all';
    this.selected = new Set();
    this.visible = [];
    this.citationEngine = new JournalCitations.Engine({ remember });
    this.$ = (s) => document.querySelector(s);
    this.$('#saved-folder').addEventListener('change', (e) => {
      this.folder = e.target.value;
      this.selected.clear();
      render();
    });
    this.$('#manage-saved-folders').addEventListener('click', () => this.manage());
    this.$('#select-saved').addEventListener('click', () => {
      this.selected = new Set(this.visible.map((a) => a.id));
      render();
    });
    this.$('#clear-saved-selection').addEventListener('click', () => {
      this.selected.clear();
      render();
    });
    this.$('#cite-saved').addEventListener('click', () =>
      this.cite(this.visible.filter((a) => this.selected.has(a.id))),
    );
    this.$('#assign-saved').addEventListener('click', () => this.assign([...this.selected]));
    this.$('#remove-saved-folder').addEventListener('click', () => {
      const f = state().folders.find((f) => f.id === this.folder);
      if (!f) return;
      f.articles = f.articles.filter((id) => !this.selected.has(id));
      persist();
      this.selected.clear();
      render();
    });
    this.$('#saved-folder-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const name = this.$('#saved-folder-name').value.trim(),
          s = state();
        if (!name) throw new Error('请输入分组名称');
        if (s.folders.some((f) => f.name === name && f.id !== this.editing))
          throw new Error('已有同名收藏分组');
        if (this.editing) {
          const f = s.folders.find((f) => f.id === this.editing);
          if (!f) throw new Error('分组已不存在');
          f.name = name;
        } else {
          if (s.folders.length >= 200) throw new Error('最多支持 200 个收藏分组');
          const id = 'folder-' + crypto.randomUUID();
          s.folders.push({ id, name, articles: [] });
          this.folder = id;
        }
        await persist();
        this.$('#saved-folder-dialog').close();
        render();
        toast('收藏分组已保存');
      } catch (error) {
        this.$('#saved-folder-message').textContent = error.message;
      }
    });
    this.$('#saved-folder-edit').addEventListener('change', () => this.editFolder());
    this.$('#delete-saved-folder').addEventListener(
      'click',
      () => (this.$('#saved-folder-delete-confirm').hidden = false),
    );
    this.$('#cancel-saved-folder-delete').addEventListener(
      'click',
      () => (this.$('#saved-folder-delete-confirm').hidden = true),
    );
    this.$('#confirm-saved-folder-delete').addEventListener('click', async () => {
      state().folders = state().folders.filter((f) => f.id !== this.editing);
      if (this.folder === this.editing) this.folder = 'all';
      try {
        await persist();
        this.$('#saved-folder-dialog').close();
        render();
        toast('已删除分组，文章仍保留在全部收藏');
      } catch (error) {
        this.$('#saved-folder-message').textContent = error.message;
      }
    });
    this.$('#save-article-folders').addEventListener('click', async () => {
      const s = state(),
        ids = this.assigning;
      for (const checkbox of this.$('#article-folder-choices').querySelectorAll('input')) {
        const f = s.folders.find((f) => f.id === checkbox.value);
        if (!f) continue;
        if (checkbox.checked) f.articles = [...new Set([...f.articles, ...ids])];
        else if (ids.length === 1) f.articles = f.articles.filter((id) => !ids.includes(id));
      }
      for (const id of ids) {
        s.saved[id] = true;
        const article = this.known().find((a) => a.id === id);
        if (article) this.remember(article);
      }
      try {
        await persist();
        this.$('#article-folders').close();
        render();
        toast('已保存文章收藏分组');
      } catch (error) {
        toast(error.message);
      }
    });
    this.$('#citation-dialog').addEventListener('close', () => {
      this.citationController?.abort();
      this.citationVersion = (this.citationVersion || 0) + 1;
    });
    this.$('#enrich-citations').addEventListener('click', () => this.enrich());
    this.$('#citation-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const old = this.citationArticles.find((a) => a.id === this.editingCitation);
        if (!old) return;
        const value = {
          ...JournalCitations.metadata(
            old,
            this.journals().find((j) => j.id === old.journal_id),
          ),
          manual: true,
          authors_incomplete: false,
          checked_at: new Date().toISOString(),
        };
        for (const key of [
          'title',
          'journal',
          'year',
          'volume',
          'issue',
          'pages',
          'article_number',
          'doi',
          'status',
        ])
          value[key] = this.$('#cite-edit-' + key).value.trim();
        value.doi = JournalCitations.doi(value.doi);
        if (value.doi && !/^10\.\d{4,9}\/\S+$/.test(value.doi))
          throw new Error('请输入有效 DOI（例如 10.1037/apl0001234），未知时可留空');
        value.authors = this.$('#cite-edit-authors')
          .value.split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((line) => {
            if (line.startsWith('=')) return { literal: line.slice(1).trim() };
            const parts = line.split('|').map((s) => s.trim());
            if (parts.length !== 2 || !parts[0])
              throw new Error('每行作者请填写「姓 | 名」，机构作者用「=机构名」');
            return { family: parts[0], given: parts[1] };
          });
        const citation = JournalReading.citation(value),
          article = { ...old, citation };
        this.remember(article);
        this.citationArticles = this.citationArticles.map((a) =>
          a.id === article.id ? article : a,
        );
        this.$('#citation-edit').close();
        await this.paintCitations(this.citationVersion);
        this.toast('已保存手动核对的引用信息');
      } catch (error) {
        this.$('#citation-edit-message').textContent = error.message;
      }
    });
    this.$('#copy-bibliography').addEventListener('click', () =>
      this.copy(this.output.text, this.exportHTML()),
    );
    this.$('#download-citations-txt').addEventListener('click', () =>
      this.download(this.exportNotes() + this.output.text, 'text/plain;charset=utf-8', 'txt'),
    );
    this.$('#download-citations-html').addEventListener('click', () =>
      this.download(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>APA references</title><body>' +
          this.exportHTML() +
          '</body></html>',
        'text/html;charset=utf-8',
        'html',
      ),
    );
    for (const extension of ['ris', 'bib'])
      this.$('#download-citations-' + extension).addEventListener('click', () =>
        this.download(
          JournalCitations.exportRecords(this.output.rows, extension, this.state().annotations),
          'text/plain;charset=utf-8',
          extension,
        ),
      );
  }
  node(tag, text) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  button(text, fn) {
    const b = this.node('button', text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  matches(article) {
    if (this.folder === 'all') return true;
    if (this.folder === 'unfiled')
      return !this.state().folders.some((f) => f.articles.includes(article.id));
    return !!this.state()
      .folders.find((f) => f.id === this.folder)
      ?.articles.includes(article.id);
  }
  sync(active, articles) {
    const state = this.state();
    if (
      !['all', 'unfiled'].includes(this.folder) &&
      !state.folders.some((folder) => folder.id === this.folder)
    )
      this.folder = 'all';
    // A bookmark can exist before its article metadata has been restored.
    this.$('#saved-tools').hidden = !active || !Object.keys(state.saved).length;
    if (!active) return;
    const select = this.$('#saved-folder');
    select.replaceChildren(new Option('全部收藏', 'all'), new Option('未分组', 'unfiled'));
    for (const folder of state.folders)
      select.add(new Option(`${folder.name}（${folder.articles.length}）`, folder.id));
    select.value = this.folder;
    this.visible = articles;
    const visibleIds = new Set(articles.map((article) => article.id));
    this.selected = new Set([...this.selected].filter((id) => visibleIds.has(id)));
    const hasSelection = this.selected.size > 0;
    this.$('#saved-batch-actions').hidden = !articles.length;
    this.$('#saved-selection-count').hidden = !articles.length;
    this.$('#saved-selection-count').textContent =
      `已选 ${this.selected.size} / 当前筛选 ${articles.length} 篇（包含未展开的文章）`;
    for (const id of [
      'cite-saved',
      'assign-saved',
      'clear-saved-selection',
      'remove-saved-folder',
    ]) {
      const control = this.$('#' + id);
      control.disabled = !hasSelection;
      control.hidden = !hasSelection;
    }
    this.$('#remove-saved-folder').hidden ||= ['all', 'unfiled'].includes(this.folder);
  }
  checkbox(article) {
    const label = this.node('label'),
      c = this.node('input');
    c.type = 'checkbox';
    c.checked = this.selected.has(article.id);
    c.dataset.savedSelect = article.id;
    c.setAttribute('aria-label', '选择文章：' + article.title);
    c.addEventListener('change', () => {
      if (c.checked) this.selected.add(article.id);
      else this.selected.delete(article.id);
      this.render();
      document.querySelector('[data-saved-select="' + article.id + '"]')?.focus();
    });
    label.append(c, document.createTextNode(' 选择'));
    return label;
  }
  manage() {
    const select = this.$('#saved-folder-edit');
    select.replaceChildren(new Option('＋ 新建收藏分组', ''));
    for (const f of this.state().folders) select.add(new Option(f.name, f.id));
    select.value = this.state().folders.some((f) => f.id === this.folder) ? this.folder : '';
    this.editFolder();
    this.$('#saved-folder-dialog').showModal();
  }
  editFolder() {
    this.editing = this.$('#saved-folder-edit').value;
    this.$('#saved-folder-name').value =
      this.state().folders.find((f) => f.id === this.editing)?.name || '';
    this.$('#delete-saved-folder').hidden = !this.editing;
    this.$('#saved-folder-delete-confirm').hidden = true;
    this.$('#saved-folder-message').textContent = '';
  }
  assign(ids, article) {
    this.assigning = ids;
    if (article) this.remember(article);
    const choices = this.$('#article-folder-choices');
    choices.replaceChildren();
    for (const f of this.state().folders) {
      const label = this.node('label'),
        c = this.node('input');
      c.type = 'checkbox';
      c.value = f.id;
      c.checked = ids.length === 1 && f.articles.includes(ids[0]);
      label.append(c, document.createTextNode(' ' + f.name));
      choices.append(label);
    }
    if (!this.state().folders.length)
      choices.append(this.node('p', '还没有收藏分组。可在「全部收藏 → 管理收藏分组」中新建。'));
    this.$('#article-folder-hint').textContent =
      ids.length === 1
        ? '勾选文章所属分组；取消所有勾选后仍保留在全部收藏。'
        : '将 ' + ids.length + ' 篇文章加入勾选的分组，保留它们原有的其他分组。';
    this.$('#article-folders').showModal();
  }
  async cite(articles) {
    if (!articles.length) return;
    this.citationController?.abort();
    this.citationController = new AbortController();
    const version = (this.citationVersion = (this.citationVersion || 0) + 1);
    const known = this.known();
    this.citationArticles = articles.map(
      (a) =>
        JournalReading.merge(
          [a],
          known.filter((k) => k.id === a.id),
        )[0],
    );
    this.output = null;
    this.$('#citation-preview').replaceChildren();
    this.$('#citation-intext').replaceChildren();
    this.$('#citation-warnings').replaceChildren();
    this.$('#citation-status').textContent = '正在生成 APA 7 引用…';
    this.enableExports(false);
    this.$('#enrich-citations').disabled = true;
    this.$('#citation-dialog').showModal();
    try {
      await this.paintCitations(version);
      if (version === this.citationVersion && articles.length === 1) await this.enrich();
    } catch (error) {
      if (version === this.citationVersion) this.$('#citation-status').textContent = error.message;
    }
  }
  async paintCitations(version, errors = []) {
    const assets = await this.citationEngine.assetsFor();
    if (version !== this.citationVersion) return;
    const rows = this.citationArticles.map((a) => ({
      ...a,
      citation: JournalCitations.metadata(
        a,
        this.journals().find((j) => j.id === a.journal_id),
      ),
    }));
    this.output = JournalCitations.format(rows, assets);
    this.$('#citation-preview').replaceChildren(this.safeHTML(this.output.html));
    const warnings = this.$('#citation-warnings');
    warnings.replaceChildren();
    for (const entry of this.output.entries)
      if (entry.warnings.length)
        warnings.append(this.node('li', entry.title + '：' + entry.warnings.join('；')));
    for (const error of errors) warnings.append(this.node('li', error));
    this.$('#citation-status').textContent =
      `已生成 ${this.output.rows.length} 条参考文献${rows.length > this.output.rows.length ? '（已合并重复 DOI）' : ''}。` +
      (this.output.entries.some((e) => e.warnings.length)
        ? '以下为待核对草稿，请先补齐缺失信息。'
        : '格式已生成，请对照原文核对书目信息。') +
      (rows.some((r) => r.citation.manual) ? ' 包含手动核对的信息。' : '');
    const intext = this.$('#citation-intext');
    intext.replaceChildren();
    for (const e of this.output.entries) {
      const row = this.node('div');
      row.append(
        this.node('strong', e.title),
        this.button('复制 ' + e.parenthetical, () => this.copy(e.parenthetical)),
        this.button('复制 ' + e.narrative, () => this.copy(e.narrative)),
        this.button('核对 / 编辑书目信息', () => this.editCitation(e.id)),
      );
      intext.append(row);
    }
    this.enableExports(true);
    this.$('#enrich-citations').disabled = false;
  }
  async enrich() {
    const version = this.citationVersion,
      signal = this.citationController.signal,
      errors = [];
    this.$('#enrich-citations').disabled = true;
    this.enableExports(false);
    try {
      for (let i = 0; i < this.citationArticles.length; i++) {
        signal.throwIfAborted();
        this.$('#citation-status').textContent =
          `正在核对书目信息 ${i + 1} / ${this.citationArticles.length}… 关闭窗口可停止。`;
        const a = this.citationArticles[i],
          journal = this.journals().find((j) => j.id === a.journal_id);
        const result = await this.citationEngine.enrich(a, journal, signal);
        signal.throwIfAborted();
        if (version !== this.citationVersion) return;
        this.citationArticles[i] = { ...a, citation: result.citation };
        if (result.error) errors.push(a.title + '：' + result.error);
      }
      await this.paintCitations(version, errors);
    } catch (error) {
      if (!signal.aborted && version === this.citationVersion) {
        this.$('#citation-status').textContent = error.message;
        this.$('#enrich-citations').disabled = false;
        this.enableExports(!!this.output);
      }
    }
  }
  enableExports(enabled) {
    for (const id of [
      'copy-bibliography',
      'download-citations-txt',
      'download-citations-html',
      'download-citations-ris',
      'download-citations-bib',
    ])
      this.$('#' + id).disabled = !enabled;
  }
  editCitation(id) {
    this.citationController?.abort();
    this.citationController = new AbortController();
    this.citationVersion++;
    this.$('#enrich-citations').disabled = false;
    this.enableExports(!!this.output);
    this.editingCitation = id;
    const a = this.citationArticles.find((a) => a.id === id),
      c = JournalCitations.metadata(
        a,
        this.journals().find((j) => j.id === a.journal_id),
      );
    for (const key of [
      'title',
      'journal',
      'year',
      'volume',
      'issue',
      'pages',
      'article_number',
      'doi',
      'status',
    ])
      this.$('#cite-edit-' + key).value = c[key] || '';
    this.$('#cite-edit-authors').value = c.authors
      .map((a) => (a.literal ? '=' + a.literal : a.family + ' | ' + (a.given || '')))
      .join('\n');
    this.$('#citation-edit-message').textContent = '';
    this.$('#citation-edit').showModal();
  }
  safeHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html'),
      fragment = document.createDocumentFragment();
    const copy = (source, target) => {
      for (const child of source.childNodes) {
        if (child.nodeType === 3) target.append(document.createTextNode(child.textContent));
        else if (child.nodeType === 1) {
          const n = document.createElement(
            ['DIV', 'I', 'B', 'SUP', 'SUB', 'SPAN'].includes(child.tagName)
              ? child.tagName
              : 'span',
          );
          if (child.classList.contains('csl-entry')) n.className = 'csl-entry';
          copy(child, n);
          target.append(n);
        }
      }
    };
    copy(doc.body, fragment);
    return fragment;
  }
  exportNotes() {
    const notes = this.output.entries
      .filter((e) => e.warnings.length)
      .map((e) => e.title + '：' + e.warnings.join('；'));
    return notes.length ? '待核对的引用草稿\n' + notes.join('\n') + '\n\n参考文献\n\n' : '';
  }
  exportHTML() {
    const div = this.node('div');
    div.append(this.safeHTML(this.output.html));
    for (const entry of div.querySelectorAll('.csl-entry'))
      entry.setAttribute(
        'style',
        'margin:0 0 12pt 0;padding-left:36pt;text-indent:-36pt;line-height:2;font-family:"Times New Roman",serif;font-size:12pt',
      );
    const notes = this.node('p', this.exportNotes());
    return notes.outerHTML + div.innerHTML;
  }
  async copy(text, html) {
    try {
      if (html && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob([this.exportNotes() + text], { type: 'text/plain' }),
              'text/html': new Blob([html], { type: 'text/html' }),
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText(this.exportNotes() + text);
          this.toast('已复制纯文本；保留斜体可下载 HTML 后用 Word 打开');
          return;
        }
      } else await navigator.clipboard.writeText(text);
      this.toast('已复制' + (html ? '，可粘贴到 Word（保留源格式）' : ''));
    } catch {
      this.toast('剪贴板不可用，请下载文件或选择预览文字复制');
    }
  }
  download(body, type, extension) {
    const url = URL.createObjectURL(new Blob([body], { type })),
      a = this.node('a');
    a.href = url;
    a.download =
      (['ris', 'bib'].includes(extension) ? 'references-' : 'APA-references-') +
      new Date().toISOString().slice(0, 10) +
      '.' +
      extension;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
