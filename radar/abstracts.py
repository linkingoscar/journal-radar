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
from urllib.parse import quote, urljoin, urlsplit, urlencode

import requests

PUBLISHERS = ('doi.org', 'apa.org', 'sciencedirect.com', 'elsevier.com', 'wiley.com',
              'aom.org', 'sagepub.com', 'springer.com', 'springernature.com', 'nature.com',
              'tandfonline.com', 'oup.com', 'informs.org', 'uchicago.edu', 'uchicagopress.com',
              'cambridge.org', 'aeaweb.org', 'jmis-web.org', 'misq.org', 'hbr.org', 'mit.edu', 'emerald.com')
API_HOSTS = ('api.openalex.org', 'api.crossref.org')
LOOKUP_VERSION = 2
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


def record_matches(article, identifier, title):
    if not doi(article.get('doi')) or doi(identifier) != doi(article.get('doi')):
        return False
    if title_matches(article['title'], title):
        return True
    # CAR's RSS joins the English and French titles without a separator.
    # Keep this exception restricted to the same DOI in this bilingual journal.
    if article.get('journal_id') == '0823-9150' and doi(identifier).startswith('10.1111/1911-3846.'):
        expected, actual = (re.sub(r'[^\w]', '', clean(x).casefold()) for x in (article['title'], title))
        return len(actual) >= 30 and expected.startswith(actual) and len(expected) > len(actual)
    return False


def from_openalex(record, article):
    if not record_matches(article, record.get('doi'), record.get('title')):
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


def fetch(url, before_request=None):
    """Bounded public HTTPS requests; every redirect stays within known source domains."""
    for _ in range(6):
        if not allowed_url(url):
            raise ValueError('来源地址不在支持范围内')
        if before_request:
            before_request(url)
        with requests.get(url, timeout=(5, 12), allow_redirects=False, stream=True,
                          headers={'User-Agent': 'JournalRadar/1.0 (+https://github.com/linkingoscar/journal-radar)'}) as r:
            if r.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, r.headers.get('Location', ''))
                if url.startswith('http://journals.aom.org/'):
                    url = 'https://' + url[len('http://'):]
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


class SourceDeferred(ValueError):
    def __init__(self, reason, retry_at):
        self.reason, self.retry_at = reason, retry_at
        super().__init__(reason)


def source_host(url):
    host = (urlsplit(url).hostname or '').lower()
    return next((h for h in PUBLISHERS if host == h or host.endswith('.' + h)), host)


class AbstractService:
    def __init__(self, directory, getter=fetch):
        self.path = Path(directory) / 'history.db'
        self.getter = getter
        self.lock = threading.Lock()
        self.request_lock = threading.Lock()
        self.last_request = 0
        with self.connection() as c:
            c.execute('CREATE TABLE IF NOT EXISTS radar_abstracts (article_id TEXT PRIMARY KEY, fingerprint TEXT, result TEXT)')
            c.execute('CREATE TABLE IF NOT EXISTS radar_source_backoff (host TEXT PRIMARY KEY, retry_at REAL, reason TEXT)')

    def request(self, url):
        def before_request(target):
            with self.connection() as c:
                row = c.execute('SELECT retry_at,reason FROM radar_source_backoff WHERE host=?', (source_host(target),)).fetchone()
            if row and row[0] > time.time():
                raise SourceDeferred(row[1], row[0])
            with self.request_lock:
                time.sleep(max(0, .5 - (time.monotonic() - self.last_request)))
                self.last_request = time.monotonic()
        try:
            if self.getter is fetch:
                return fetch(url, before_request)
            before_request(url)
            return self.getter(url)
        except requests.RequestException as exc:
            response = getattr(exc, 'response', None)
            status = response.status_code if response is not None else None
            reason = 'access_denied' if status in (401,403) else 'rate_limited' if status == 429 else 'network_error'
            delay = 21600 if reason == 'access_denied' else 300 if reason == 'rate_limited' else 60
            if status == 429:
                try: delay = max(delay, min(86400, float(response.headers.get('Retry-After', delay))))
                except ValueError: pass
            if status != 404:
                target = (response.url if response is not None and response.url else None) or getattr(getattr(exc, 'request', None), 'url', None) or url
                retry_at = time.time() + delay
                with self.connection() as c:
                    c.execute('INSERT OR REPLACE INTO radar_source_backoff VALUES (?,?,?)', (source_host(target), retry_at, reason))
                raise SourceDeferred(reason, retry_at) from exc
            raise

    def connection(self):
        return sqlite3.connect(self.path, timeout=30)

    def fingerprint(self, article):
        return hashlib.sha256((doi(article.get('doi')) + '\n' + article['title']).encode()).hexdigest()

    def cached(self, article):
        with self.connection() as c:
            row = c.execute('SELECT result FROM radar_abstracts WHERE article_id=? AND fingerprint=?', (article['id'], self.fingerprint(article))).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, article, result):
        result = {**result, 'checked_at': time.time(), 'version': LOOKUP_VERSION}
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
            if item and item[0] == self.fingerprint(article) and item[1].get('resolved_doi'):
                article['resolved_doi'] = item[1]['resolved_doi']
            if not article['abstract'] and item and item[0] == self.fingerprint(article) and item[1].get('abstract'):
                result = item[1]
                article.update(abstract=result['abstract'], abstract_source=result['source'], abstract_url=result['source_url'])
        return payload

    def resolve_doi(self, article):
        journal = article.get('journal_id', '')
        if not re.fullmatch(r'\d{4}-\d{3}[\dX]', journal) or len(clean(article['title'])) < 30:
            return None
        url = 'https://api.crossref.org/journals/' + journal + '/works?' + urlencode({'query.bibliographic': article['title'], 'rows': 5})
        body, _ = self.request(url)
        matches = {}
        for record in json.loads(body).get('message', {}).get('items', []):
            identifier = doi(record.get('DOI'))
            title = (record.get('title') or [''])[0]
            if (record.get('type') == 'journal-article' and re.fullmatch(r'10\.\d{4,9}/\S+', identifier)
                    and set(record.get('ISSN', [])) & set(article.get('issns') or [journal])
                    and re.sub(r'[^\w]', '', clean(title).casefold()) == re.sub(r'[^\w]', '', clean(article['title']).casefold())):
                matches[identifier] = record
        # Never choose an arbitrary top result when more than one DOI matches.
        return next(iter(matches.values())) if len(matches) == 1 else None

    def due(self, article, full=False):
        previous = self.cached(article)
        if not previous:
            return True
        if previous.get('abstract'):
            return False
        if previous.get('version') != LOOKUP_VERSION:
            return True
        if full and previous.get('attempt') != 'full':
            return True
        return time.time() >= previous.get('retry_at', previous['checked_at'] + 86400)

    def lookup(self, article, background=False):
        # One on-demand lookup at a time also collapses simultaneous opens of the same article.
        with self.lock:
            previous = self.cached(article)
            if previous and not self.due(article, full=True):
                return {**previous, 'cached': True}
            errors = []
            reasons, retries = [], []
            original = article
            identifier = doi(article.get('doi')) or (previous or {}).get('resolved_doi', '')
            def failure(provider, exc):
                reason = exc.reason if isinstance(exc, SourceDeferred) else 'network_error' if isinstance(exc, requests.RequestException) else 'unsupported_or_invalid'
                errors.append(provider + ': ' + reason)
                reasons.append(reason)
                if isinstance(exc, SourceDeferred): retries.append(exc.retry_at)
            def save(result):
                if identifier and not original.get('doi'):
                    result['resolved_doi'] = identifier
                return self.save(original, result)
            if not identifier:
                try:
                    record = self.resolve_doi(article)
                    if record:
                        identifier = doi(record['DOI'])
                        text = valid_abstract(record.get('abstract'))
                        if text:
                            return save({'status': 'found', 'abstract': text, 'source': 'Crossref', 'source_url': 'https://doi.org/' + identifier})
                except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
                    failure('DOI 检索', exc)
            article = {**article, 'doi': identifier}
            if identifier:
                for provider in ('OpenAlex', 'Crossref'):
                    # The background queue already checks OpenAlex in DOI batches.
                    if background and provider == 'OpenAlex' and previous and previous.get('version') == LOOKUP_VERSION and previous.get('index_checked_at', 0) > time.time() - 86400:
                        continue
                    # A current Crossref feed record with an empty abstract need not be fetched again per article.
                    if background and provider == 'Crossref' and 'crossref' in (article.get('sources') or '').split(','):
                        continue
                    try:
                        url = ('https://api.openalex.org/works/https://doi.org/' if provider == 'OpenAlex' else 'https://api.crossref.org/works/') + quote(identifier, safe='/')
                        body, _ = self.request(url)
                        record = json.loads(body)
                        if provider == 'OpenAlex':
                            text = from_openalex(record, article)
                            source_url = record.get('id', '')
                        else:
                            record = record.get('message', {})
                            text = valid_abstract(record.get('abstract')) if record_matches(article, record.get('DOI'), (record.get('title') or [''])[0]) else ''
                            source_url = 'https://doi.org/' + identifier
                        if text:
                            return save({'status': 'found', 'abstract': text, 'source': provider, 'source_url': source_url})
                    except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
                        failure(provider, exc)
            try:
                body, url = self.request(article['link'])
                text = from_html(body, article)
                if text:
                    return save({'status': 'found', 'abstract': text, 'source': '出版商网页', 'source_url': url})
            except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
                failure('出版商网页', exc)
            reason = next((r for r in ('rate_limited', 'access_denied', 'network_error', 'unsupported_or_invalid') if r in reasons), 'not_provided')
            messages = {'rate_limited': '来源限流，已暂停该来源，稍后补采会自动重试。',
                        'access_denied': '出版商限制自动访问，已保存记录；可打开原文查看。',
                        'network_error': '来源暂时连接失败，稍后补采会自动重试。',
                        'unsupported_or_invalid': '来源页面暂不支持，或摘要未通过身份与完整性核对。',
                        'not_provided': '已检查支持的来源，暂未取得完整摘要。'}
            return save({'status': 'unavailable', 'attempt': 'full', 'abstract': '', 'reason': reason,
                         'retry_at': min(retries) if retries else time.time() + 86400,
                         'index_checked_at': (previous or {}).get('index_checked_at', 0),
                         'message': messages[reason], 'errors': errors})

    def batch(self, payload, limit=500, stop=None, progress=None):
        """Cloud-friendly DOI batches; unsuccessful lookups are retried the following day."""
        candidates = []
        for a in payload['articles']:
            if readable_abstract(a.get('abstract')) or not doi(a.get('doi')):
                continue
            if not self.due(a):
                continue
            candidates.append(a)
        found, checked = 0, 0
        for offset in range(0, min(len(candidates), limit), 50):
            if stop and stop.is_set():break
            batch = candidates[offset:min(offset + 50, limit)]
            identifiers = '|'.join('https://doi.org/' + doi(a['doi']) for a in batch)
            from urllib.parse import urlencode
            url = 'https://api.openalex.org/works?' + urlencode({'filter': 'doi:' + identifiers, 'select': 'id,doi,title,abstract_inverted_index', 'per_page': 100})
            try:
                body, _ = self.request(url)
                records = {doi(r.get('doi')): r for r in json.loads(body)['results']}
            except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
                return {'checked': checked, 'found': found, 'error': type(exc).__name__}
            for article in batch:
                record = records.get(doi(article['doi']), {})
                text = from_openalex(record, article)
                self.save(article, {'status': 'found' if text else 'unavailable', 'attempt': 'index',
                                    'abstract': text, 'source': 'OpenAlex', 'source_url': record.get('id', ''),
                                    'index_checked_at': time.time()})
                checked += 1
                found += bool(text)
            if progress:progress(checked, min(len(candidates), limit), found)
            time.sleep(1)
        return {'checked': checked, 'found': found}

    def enrich(self, payload, stop, progress):
        """Resumable local queue; every completed item is cached before advancing."""
        self.overlay(payload)
        journals = {j['id']: j for j in payload['journals']}
        missing = [a for a in payload['articles'] if not readable_abstract(a.get('abstract'))]
        missing.sort(key=lambda a: a.get('published_date') or '', reverse=True)
        missing.sort(key=lambda a: 'hr35' not in journals[a['journal_id']]['groups'])
        report = {'checked': 0, 'found': 0, 'total': 0, 'missing_before': len(missing), 'reasons': {}, 'paused': False}
        def index_progress(checked, total, found):
            progress({**report, 'stage': 'index', 'checked': checked, 'total': total, 'found': found})
        batch = self.batch({'articles': missing}, len(missing), stop, index_progress)
        report['found'] = batch['found']
        if batch.get('error'):report['index_error'] = batch['error']
        self.overlay(payload)
        pending = []
        for a in missing:
            if readable_abstract(a.get('abstract')):continue
            # Retain notices in the library; don't repeatedly scrape obvious non-research records.
            if re.match(r'^(?:issue information|editorial board|front matter|back matter|table of contents|erratum|corrigendum|correction to|retraction notice)(?:\b|:)', a['title'], re.I):
                report['reasons']['notice'] = report['reasons'].get('notice', 0) + 1
                continue
            if self.due(a, full=True):pending.append(a)
            else:report['reasons']['cached'] = report['reasons'].get('cached', 0) + 1
        report['total'] = len(pending)
        progress({**report, 'stage': 'pages'})
        for a in pending:
            if stop.is_set():break
            journal = journals[a['journal_id']]
            result = self.lookup({**a, 'issns': journal['issns']}, background=True)
            report['checked'] += 1
            report['found'] += bool(result.get('abstract'))
            reason = 'found' if result.get('abstract') else result.get('reason', 'not_provided')
            report['reasons'][reason] = report['reasons'].get(reason, 0) + 1
            progress({**report, 'stage': 'pages'})
            if stop.wait(.1):break
        report['paused'] = stop.is_set()
        self.overlay(payload)
        report['remaining'] = sum(not readable_abstract(a.get('abstract')) for a in payload['articles'])
        report['found'] = report['missing_before'] - report['remaining']
        return report


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
