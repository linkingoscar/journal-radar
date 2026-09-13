"""On-demand journal archives, isolated from the recent-article feed and its jobs."""
from __future__ import annotations
import datetime as dt
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import time
from run import get, date_parts, normalize_crossref, plain

PAGE_SIZE = 250


def normalize_archive(record, journal):
    article = normalize_crossref(record, journal)
    if not article:
        return None
    article.update(id=hashlib.sha256(article['doi'].encode()).hexdigest(), journal_id=journal['id'],
                   volume=plain(record.get('volume')), issue=plain(record.get('issue')),
                   pages=plain(record.get('page')), article_number=plain(record.get('article-number')),
                   sources='crossref', first_seen='', archive=True)
    printed = article['print_date']
    date = printed or date_parts(record.get('published')) or article['online_date']
    article.update(archive_year=int(date[:4]) if date else None,
                   year_basis='print' if printed else 'publication')
    return article


class ArchiveService:
    def __init__(self, directory, registry, getter=get):
        self.path = Path(directory) / 'archives.db'
        self.history = Path(directory) / 'history.db'
        self.journals = {j['id']: j for j in registry['journals'] if j.get('enabled', True)}
        self.getter = getter
        self.lock = threading.Lock()
        with self.connection() as c:
            c.execute('CREATE TABLE IF NOT EXISTS archive_queries (key TEXT PRIMARY KEY, body TEXT)')
            c.execute('CREATE TABLE IF NOT EXISTS archive_articles (id TEXT PRIMARY KEY, journal_id TEXT, year INTEGER, body TEXT)')
            c.execute('CREATE INDEX IF NOT EXISTS archive_year ON archive_articles(journal_id,year)')

    def connection(self):
        return sqlite3.connect(self.path, timeout=30)

    def cached(self, key):
        with self.connection() as c:
            row = c.execute('SELECT body FROM archive_queries WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, c, key, value):
        c.execute('INSERT OR REPLACE INTO archive_queries VALUES (?,?)', (key, json.dumps(value, ensure_ascii=False)))

    def journal(self, identifier):
        journal = self.journals.get(identifier)
        if not journal:
            raise ValueError('未收录的期刊')
        if not journal.get('crossref_enabled', True):
            raise ValueError('此刊暂无可用的历史目录接口，可继续查看近期文章和出版商原文。')
        return journal

    def overview(self, identifier):
        journal = self.journal(identifier)
        key = identifier + ':overview'
        with self.lock:
            old = self.cached(key)
            if old and time.time() - old['checked_at'] < 30 * 86400:
                return old
            try:
                years = []
                for order in ('asc', 'desc'):
                    message = self.getter('https://api.crossref.org/journals/' + journal['issns'][0] + '/works',
                        params={'rows': 1, 'sort': 'published', 'order': order,
                                'filter': 'type:journal-article', 'select': 'published,published-print,published-online'}).json()['message']
                    for item in message['items']:
                        for field in ('published', 'published-print', 'published-online'):
                            value = date_parts(item.get(field))
                            if value and 1500 <= int(value[:4]) <= dt.date.today().year + 1:
                                years.append(int(value[:4]))
                result = {'journal_id': identifier, 'first_year': min(years) if years else None,
                          'last_year': max(years) if years else None, 'checked_at': time.time()}
                with self.connection() as c:
                    self.save(c, key, result)
                return result
            except Exception:
                if old:
                    return {**old, 'stale': True}
                raise

    def year(self, identifier, year, advance=False, refresh=False):
        journal = self.journal(identifier)
        if not 1500 <= year <= dt.date.today().year + 1:
            raise ValueError('年份超出支持范围')
        key = identifier + ':' + str(year)
        with self.lock:
            state = self.cached(key)
            if not state or refresh:
                # Scan print dates first, then publication dates for records without print dates.
                state = {'journal_id': identifier, 'year': year, 'phase': 0, 'cursor': '*',
                         'complete': False, 'scanned': 0, 'checked_at': time.time()}
                advance = True
            if advance and not state['complete']:
                phase = state['phase']
                kind = 'print-pub-date' if phase == 0 else 'pub-date'
                filters = f'from-{kind}:{year}-01-01,until-{kind}:{year}-12-31,type:journal-article'
                message = self.getter('https://api.crossref.org/journals/' + journal['issns'][0] + '/works',
                    params={'filter': filters, 'rows': PAGE_SIZE, 'cursor': state['cursor'],
                            'select': 'DOI,title,ISSN,author,volume,issue,page,article-number,published,published-online,published-print,type'}).json()['message']
                items = message['items']
                page_dois = [item.get('DOI') for item in items]
                if items and state.get('last_page') == [phase, page_dois]:
                    raise ValueError('来源重复返回同一页，已停止加载，请稍后更新目录')
                articles = []
                for record in items:
                    article = normalize_archive(record, journal)
                    if article and article['archive_year'] == year:
                        articles.append(article)
                state = {**state, 'scanned': state['scanned'] + len(items), 'checked_at': time.time(), 'last_page': [phase, page_dois]}
                cursor = message.get('next-cursor')
                if len(items) < PAGE_SIZE:
                    state.update(phase=phase + 1, cursor='*', complete=phase == 1)
                elif not cursor:
                    raise ValueError('历史目录分页未完成，请重试')
                else:
                    state['cursor'] = cursor
                # Commit page and cursor together; network errors never discard completed pages.
                with self.connection() as c:
                    for article in articles:
                        c.execute('INSERT OR REPLACE INTO archive_articles VALUES (?,?,?,?)',
                                  (article['id'], identifier, article['archive_year'], json.dumps(article, ensure_ascii=False)))
                    self.save(c, key, state)
            return self.result(identifier, year, state)

    def result(self, identifier, year, state):
        with self.connection() as c:
            articles = [json.loads(row[0]) for row in c.execute(
                'SELECT body FROM archive_articles WHERE journal_id=? AND year=?', (identifier, year))]
        aliases = {}
        # Preserve existing RSS/cloud reading identifiers for the same DOI.
        with sqlite3.connect(self.history, timeout=30) as c:
            rows = c.execute("SELECT entry_id,doi,abstract FROM matched_entries WHERE journal_id=? AND doi IS NOT NULL", (identifier,))
            canonical = {doi: (entry_id, abstract) for entry_id, doi, abstract in rows}
        for article in articles:
            existing = canonical.get(article['doi'])
            target = existing[0] if existing else None
            if existing and existing[1]:
                article['abstract'] = existing[1]
            if target and target != article['id']:
                aliases[article['id']] = target
                article['id'] = target
        return {k: v for k, v in state.items() if k not in ('cursor','last_page')} | {'articles': articles, 'reading_aliases': aliases}

    def article(self, identifier):
        with self.connection() as c:
            row = c.execute('SELECT body FROM archive_articles WHERE id=?', (identifier,)).fetchone()
        return json.loads(row[0]) if row else None
