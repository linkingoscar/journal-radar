"""Retrieve existing abstracts, verify article identity, and cache independently of feeds."""
from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import quote, urljoin, urlsplit

import requests

PUBLISHERS = ('doi.org', 'apa.org', 'sciencedirect.com', 'elsevier.com', 'wiley.com',
              'aom.org', 'sagepub.com', 'springer.com', 'springernature.com', 'nature.com',
              'tandfonline.com', 'oup.com', 'informs.org', 'uchicago.edu', 'uchicagopress.com',
              'cambridge.org', 'aeaweb.org', 'jmis-web.org', 'misq.org', 'hbr.org', 'mit.edu')
API_HOSTS = ('api.openalex.org', 'api.crossref.org')
VOID = {'meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'wbr', 'area', 'base', 'embed', 'param', 'track', 'col'}


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def clean(value):
    parser = Text()
    parser.feed(str(value or ''))
    return re.sub(r'\s+', ' ', ' '.join(parser.parts)).strip()


def readable_abstract(value):
    text = clean(value)
    if re.match(r'^Publication date\s*[:：]', text, re.I):
        match = re.search(r'\bAbstract\s*[:：]?\s+(.+)', text, re.I)
        text = match[1] if match else ''
    if (re.match(r'^.{0,150},\s*Volume\b', text, re.I)
            or re.search(r'not available|no abstract available', text, re.I)):
        return ''
    return text


def valid_abstract(value):
    text = re.sub(r'^(?:Abstract|Summary)\s*[:：]?\s+', '', readable_abstract(value), flags=re.I)
    if (not 120 <= len(text) <= 20000 or len(text.split()) < 20
            or text.endswith(('…', '...'))
            or re.search(r'enable javascript|verify you are human|access denied|checking your browser', text, re.I)):
        return ''
    return text


def doi(value):
    return re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)', '', str(value or '').strip(), flags=re.I).lower()


def title_matches(expected, actual):
    a, b = (re.sub(r'[^\w]', '', clean(x).casefold()) for x in (expected, actual))
    return bool(a and b and SequenceMatcher(None, a, b).ratio() >= .9)


def from_openalex(record, article):
    if doi(record.get('doi')) != doi(article.get('doi')) or not title_matches(article['title'], record.get('title')):
        return ''
    index = record.get('abstract_inverted_index')
    if not isinstance(index, dict):
        return ''
    words = {}
    for word, positions in index.items():
        if not isinstance(positions, list) or not isinstance(word, str):
            return ''
        for pos in positions:
            if type(pos) is not int or not 0 <= pos < 5000 or pos in words:
                return ''
            words[pos] = word
    if not words or sorted(words) != list(range(len(words))):
        return ''
    return valid_abstract(' '.join(words[i] for i in range(len(words))))


class ArticleHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.stack, self.sections, self.ld = {}, [], [], []
        self.capture = None
        self.script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta[(attrs.get('name') or attrs.get('property') or attrs.get('http-equiv') or '').lower()] = attrs.get('content', '')
        if tag in VOID:
            return
        self.stack.append(tag)
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.script = []
        identity = (attrs.get('id', '') + ' ' + attrs.get('class', '')).lower()
        if self.capture is None and tag in ('div', 'section') and re.search(r'(?:^|\s)(?:abstract|abstracts|abstractsection|abstractcontent|article-section__abstract|hlFld-Abstract)(?:\s|$)', identity, re.I):
            self.capture = (len(self.stack), [])

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            try:
                self.ld.append(json.loads(''.join(self.script)))
            except ValueError:
                pass
            self.script = None
        if tag not in self.stack:
            return
        depth = len(self.stack) - self.stack[::-1].index(tag)
        if self.capture and depth <= self.capture[0]:
            self.sections.append(' '.join(self.capture[1]))
            self.capture = None
        self.stack = self.stack[:depth - 1]

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)
        elif self.capture and not any(t in ('script', 'style', 'nav', 'button') for t in self.stack):
            self.capture[1].append(data)


def from_html(html, article):
    page = ArticleHTML()
    page.feed(html)
    meta = page.meta
    declared = [meta[k] for k in ('citation_doi', 'dc.identifier', 'dc.identifier.doi', 'prism.doi') if meta.get(k) and '10.' in meta[k]]
    same = any(doi(x) == doi(article.get('doi')) for x in declared) if declared else any(
        title_matches(article['title'], meta.get(k)) for k in ('citation_title', 'dc.title', 'og:title'))
    if same:
        candidates = [meta.get(k) for k in ('citation_abstract', 'dc.description', 'dcterms.abstract')]
        candidates += page.sections
        for candidate in candidates:
            text = valid_abstract(candidate)
            if text:
                return text
    # Only accept a matching scholarly-article object, never a website description or related article.
    def objects(value):
        if isinstance(value, list):
            for item in value:
                yield from objects(item)
        elif isinstance(value, dict):
            yield value
            yield from objects(value.get('@graph', []))
    for value in page.ld:
        for item in objects(value):
            if item.get('@type') in ('ScholarlyArticle', 'Article') and title_matches(article['title'], item.get('headline') or item.get('name')):
                if declared and not same:
                    continue
                text = valid_abstract(item.get('abstract'))
                if text:
                    return text
    return ''


def allowed_url(url):
    try:
        p = urlsplit(url)
        host = (p.hostname or '').lower()
        return (p.scheme == 'https' and p.port in (None, 443) and not p.username and not p.password
                and (host in API_HOSTS or any(host == h or host.endswith('.' + h) for h in PUBLISHERS)))
    except ValueError:
        return False


def fetch(url):
    """Bounded public HTTPS requests; every redirect stays within known source domains."""
    for _ in range(6):
        if not allowed_url(url):
            raise ValueError('来源地址不在支持范围内')
        with requests.get(url, timeout=(5, 12), allow_redirects=False, stream=True,
                          headers={'User-Agent': 'JournalRadar/1.0 (+https://github.com/linkingoscar/journal-radar)'}) as r:
            if r.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, r.headers.get('Location', ''))
                continue
            r.raise_for_status()
            chunks, size = [], 0
            for chunk in r.iter_content(65536):
                size += len(chunk)
                if size > 4_000_000:
                    raise ValueError('来源页面过大')
                chunks.append(chunk)
            text = b''.join(chunks).decode(r.encoding if r.encoding and r.encoding.lower() != 'iso-8859-1' else 'utf-8', errors='replace')
            # Some DOI destinations use a normal HTML refresh instead of an HTTP redirect.
            if 'text/html' in r.headers.get('Content-Type', ''):
                page = ArticleHTML(); page.feed(text)
                refresh = re.search(r'url\s*=\s*[\'\"]?(.+?)[\'\"]?$', page.meta.get('refresh', ''), re.I)
                if refresh:
                    url = urljoin(url, refresh[1]); continue
            return text, url
    raise ValueError('来源重定向次数过多')


class AbstractService:
    def __init__(self, directory, getter=fetch):
        self.path = Path(directory) / 'history.db'
        self.getter = getter
        self.lock = threading.Lock()
        with self.connection() as c:
            c.execute('CREATE TABLE IF NOT EXISTS radar_abstracts (article_id TEXT PRIMARY KEY, fingerprint TEXT, result TEXT)')

    def connection(self):
        return sqlite3.connect(self.path, timeout=30)

    def fingerprint(self, article):
        return hashlib.sha256((doi(article.get('doi')) + '\n' + article['title']).encode()).hexdigest()

    def cached(self, article):
        with self.connection() as c:
            row = c.execute('SELECT result FROM radar_abstracts WHERE article_id=? AND fingerprint=?', (article['id'], self.fingerprint(article))).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, article, result):
        result = {**result, 'checked_at': time.time()}
        with self.connection() as c:
            c.execute('BEGIN IMMEDIATE')
            old = c.execute('SELECT result FROM radar_abstracts WHERE article_id=? AND fingerprint=?', (article['id'], self.fingerprint(article))).fetchone()
            if old and json.loads(old[0]).get('abstract'):
                return json.loads(old[0])
            c.execute('INSERT OR REPLACE INTO radar_abstracts VALUES (?,?,?)', (article['id'], self.fingerprint(article), json.dumps(result, ensure_ascii=False)))
        return result

    def overlay(self, payload):
        with self.connection() as c:
            cached = {r[0]: (r[1], json.loads(r[2])) for r in c.execute('SELECT * FROM radar_abstracts')}
        for article in payload['articles']:
            article['abstract'] = readable_abstract(article.get('abstract'))
            item = cached.get(article['id'])
            if not article['abstract'] and item and item[0] == self.fingerprint(article) and item[1].get('abstract'):
                result = item[1]
                article.update(abstract=result['abstract'], abstract_source=result['source'], abstract_url=result['source_url'])
        return payload

    def lookup(self, article):
        # One on-demand lookup at a time also collapses simultaneous opens of the same article.
        with self.lock:
            previous = self.cached(article)
            if previous and (previous.get('abstract') or (previous.get('attempt') == 'full' and time.time() - previous['checked_at'] < 3600)):
                return {**previous, 'cached': True}
            errors = []
            identifier = doi(article.get('doi'))
            if identifier:
                for provider in ('OpenAlex', 'Crossref'):
                    try:
                        url = ('https://api.openalex.org/works/https://doi.org/' if provider == 'OpenAlex' else 'https://api.crossref.org/works/') + quote(identifier, safe='/')
                        body, _ = self.getter(url)
                        record = json.loads(body)
                        if provider == 'OpenAlex':
                            text = from_openalex(record, article)
                            source_url = record.get('id', '')
                        else:
                            record = record.get('message', {})
                            text = valid_abstract(record.get('abstract')) if doi(record.get('DOI')) == identifier and title_matches(article['title'], (record.get('title') or [''])[0]) else ''
                            source_url = 'https://doi.org/' + identifier
                        if text:
                            return self.save(article, {'status': 'found', 'abstract': text, 'source': provider, 'source_url': source_url})
                    except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
                        errors.append(provider + ': ' + type(exc).__name__)
            try:
                body, url = self.getter(article['link'])
                text = from_html(body, article)
                if text:
                    return self.save(article, {'status': 'found', 'abstract': text, 'source': '出版商网页', 'source_url': url})
            except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
                errors.append('出版商网页: ' + type(exc).__name__)
            return self.save(article, {'status': 'unavailable', 'attempt': 'full', 'abstract': '',
                                      'message': '暂未获取到可核对的摘要，来源可能尚未提供或限制访问。可打开原文查看，1 小时后可重试。', 'errors': errors})

    def batch(self, payload, limit=500):
        """Cloud-friendly DOI batches; unsuccessful lookups are retried the following day."""
        candidates = []
        for a in payload['articles']:
            if readable_abstract(a.get('abstract')) or not doi(a.get('doi')):
                continue
            old = self.cached(a)
            if old and (old.get('abstract') or time.time() - old['checked_at'] < 86400):
                continue
            candidates.append(a)
        found, checked = 0, 0
        for offset in range(0, min(len(candidates), limit), 50):
            batch = candidates[offset:min(offset + 50, limit)]
            identifiers = '|'.join('https://doi.org/' + doi(a['doi']) for a in batch)
            from urllib.parse import urlencode
            url = 'https://api.openalex.org/works?' + urlencode({'filter': 'doi:' + identifiers, 'select': 'id,doi,title,abstract_inverted_index', 'per_page': 100})
            try:
                body, _ = self.getter(url)
                records = {doi(r.get('doi')): r for r in json.loads(body)['results']}
            except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
                return {'checked': checked, 'found': found, 'error': type(exc).__name__}
            for article in batch:
                record = records.get(doi(article['doi']), {})
                text = from_openalex(record, article)
                self.save(article, {'status': 'found' if text else 'unavailable', 'attempt': 'index',
                                    'abstract': text, 'source': 'OpenAlex', 'source_url': record.get('id', '')})
                checked += 1
                found += bool(text)
            time.sleep(1)
        return {'checked': checked, 'found': found}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default='radar-data')
    parser.add_argument('--site', default='site/data.json')
    parser.add_argument('--limit', type=int, default=500)
    args = parser.parse_args()
    path = Path(args.site)
    payload = json.loads(path.read_text(encoding='utf-8'))
    service = AbstractService(args.data_dir)
    report = service.batch(payload, args.limit)
    print(json.dumps(report))
    payload['abstract_enrichment'] = {**report, 'checked_at': time.time()}
    service.overlay(payload)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temp.replace(path)
