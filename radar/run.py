"""Personal journal edition of Paper Firehose. No AI keys or model downloads."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import time
from urllib.parse import quote, unquote, urlsplit, urlunsplit, urljoin

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
os.environ.setdefault('PAPER_FIREHOSE_DATA_DIR', str(ROOT / 'radar-data'))

import feedparser
import requests
from paper_firehose.core.database import DatabaseManager
from paper_firehose.core.doi_utils import extract_doi_from_entry
from paper_firehose.core.text_utils import strip_jats


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def plain(value):
    return re.sub(r'\s+', ' ', strip_jats(str(value or '')) or '').strip()


def safe_url(value):
    value = str(value or '').strip()
    p = urlsplit(value)
    return value if p.scheme in ('http', 'https') and p.netloc and not p.username else ''


def doi_of(entry):
    # Do not extract another paper's DOI from citations inside an abstract.
    fields = {k: unquote(str(entry[k])) for k in ('doi','dc_identifier','prism_doi','prism:doi','guid','id','link') if entry.get(k)}
    doi = extract_doi_from_entry(fields)
    return doi.rstrip('.,').lower() if doi else ''


def date_parts(value):
    parts = (value or {}).get('date-parts', [[]])[0]
    if not parts: return ''
    try: return dt.date(*((parts + [1,1])[:3])).isoformat()
    except (ValueError, TypeError): return ''


def normalized_title(value):
    return re.sub(r'[^\w]+', '', plain(value).casefold())


def is_supplement(title, doi):
    return title.casefold().startswith(('supplemental material for ', 'supplementary material for ')) or doi.endswith('.supp')


def normalize_crossref(item, journal):
    if not set(item.get('ISSN', [])) & set(journal['issns']):
        raise ValueError('Crossref 返回的 ISSN 与期刊不匹配')
    online = date_parts(item.get('published-online'))
    printed = date_parts(item.get('published-print'))
    title = plain((item.get('title') or [''])[0])
    doi = doi_of({'doi':item.get('DOI')})
    if not title or not doi or is_supplement(title, doi): return None
    return dict(title=title, doi=doi, link='https://doi.org/'+doi,
                authors=', '.join(plain(' '.join(filter(None,[a.get('given'),a.get('family')]))) or plain(a.get('name')) for a in item.get('author',[])),
                abstract=plain(item.get('abstract')), published_date=online or date_parts(item.get('published')) or printed,
                online_date=online, print_date=printed, article_type=item.get('type','journal-article'), source='crossref', source_rank=2)


def normalize_rss(entry, journal):
    title=plain(entry.get('title'))
    link=safe_url(urljoin(journal.get('site_url',''),entry.get('link') or ''))
    doi=doi_of(entry)
    if not title or not (link or doi) or is_supplement(title, doi): return None
    stamp=entry.get('published_parsed') or entry.get('updated_parsed')
    published=dt.date(*stamp[:3]).isoformat() if stamp else ''
    text=entry.get('summary') or entry.get('description') or ''
    if not text and entry.get('content'): text=entry['content'][0].get('value','')
    text=plain(text)
    if not re.search(r'\w',text) or 'Not available' in text: text=''
    return dict(title=title,doi=doi,link='https://doi.org/'+doi if doi else link,
                authors=plain(entry.get('author') or ', '.join(a.get('name','') for a in entry.get('authors',[]))),
                abstract=text,published_date=published,online_date='',print_date='',
                article_type='rss-entry',source='rss',source_rank=1)


class RadarStore(DatabaseManager):
    """Reuse upstream history schema, connections and search-index maintenance."""
    def __init__(self, directory):
        directory=Path(directory).resolve(); directory.mkdir(parents=True,exist_ok=True)
        super().__init__({'database':{'path':str(directory/'current.db'),'all_feeds_path':str(directory/'feeds.db'),'history_path':str(directory/'history.db')}})
        with self.get_connection('history') as conn:
            existing={x['name'] for x in conn.execute('PRAGMA table_info(matched_entries)')}
            for column,definition in {'journal_id':'TEXT','online_date':'TEXT','print_date':'TEXT','article_type':'TEXT','sources':'TEXT','source_rank':'INTEGER DEFAULT 0','title_key':'TEXT'}.items():
                if column not in existing: conn.execute(f'ALTER TABLE matched_entries ADD COLUMN {column} {definition}')
            conn.execute('CREATE INDEX IF NOT EXISTS radar_doi ON matched_entries(doi)')
            conn.execute('CREATE INDEX IF NOT EXISTS radar_title ON matched_entries(journal_id,title_key)')
            conn.execute('''CREATE TABLE IF NOT EXISTS radar_health (
              journal_id TEXT, source TEXT, last_attempt TEXT, last_success TEXT,
              error TEXT, item_count INTEGER, PRIMARY KEY(journal_id,source))''')

    def health(self):
        with self.get_connection('history') as conn:
            return {(r['journal_id'],r['source']):dict(r) for r in conn.execute('SELECT * FROM radar_health')}

    def record_health(self,jid,source,attempt,error,count):
        with self.get_connection('history') as conn:
            conn.execute('''INSERT INTO radar_health VALUES(?,?,?,?,?,?)
                ON CONFLICT(journal_id,source) DO UPDATE SET last_attempt=excluded.last_attempt,
                last_success=CASE WHEN excluded.error IS NULL THEN excluded.last_success ELSE radar_health.last_success END,
                error=excluded.error,item_count=excluded.item_count''',
                (jid,source,attempt,attempt if not error else None,error,count))

    def ingest(self, journal, entries):
        inserted=0
        with self.get_connection('history') as conn:
            for entry in entries:
                if not entry: continue
                entry=dict(entry)
                key=normalized_title(entry['title'])
                doi=entry['doi']
                previous=None
                if doi: previous=conn.execute('SELECT * FROM matched_entries WHERE doi=?',(doi,)).fetchone()
                if not previous and entry['link']:
                    previous=conn.execute("SELECT * FROM matched_entries WHERE journal_id=? AND link=? AND (doi IS NULL OR doi='' OR doi=?)",(journal['id'],entry['link'],doi)).fetchone()
                if not previous and key not in {'editorial','contents','tableofcontents','frontmatter','backmatter','cover','coverimage'}:
                    if doi:
                        previous=conn.execute("SELECT * FROM matched_entries WHERE journal_id=? AND title_key=? AND (doi IS NULL OR doi='')",(journal['id'],key)).fetchone()
                    else:
                        previous=conn.execute('SELECT * FROM matched_entries WHERE journal_id=? AND title_key=?',(journal['id'],key)).fetchone()
                identifier=previous['entry_id'] if previous else hashlib.sha256((doi or journal['id']+'|'+(entry['link'] or key)).encode()).hexdigest()
                sources=set((previous['sources'] or '').split(',')) if previous else set()
                sources.add(entry['source']);sources.discard('')
                if previous:
                    # Rich Crossref fields take precedence; missing new fields never erase history.
                    for field in ('title','authors','link','published_date','online_date','print_date','doi','article_type'):
                        if not entry.get(field) or (entry['source_rank'] < (previous['source_rank'] or 0) and previous[field]):
                            entry[field]=previous[field]
                    if not entry['abstract']: entry['abstract']=previous['abstract'] or ''
                    elif entry['source_rank'] < (previous['source_rank'] or 0) and previous['abstract']:entry['abstract']=previous['abstract']
                conn.execute('''INSERT INTO matched_entries
                    (entry_id,feed_name,topics,title,link,summary,authors,abstract,doi,published_date,matched_date,
                    journal_id,online_date,print_date,article_type,sources,source_rank,title_key)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(entry_id) DO UPDATE SET title=excluded.title,link=excluded.link,
                    authors=excluded.authors,abstract=excluded.abstract,doi=excluded.doi,published_date=excluded.published_date,
                    topics=excluded.topics,online_date=excluded.online_date,print_date=excluded.print_date,
                    article_type=excluded.article_type,sources=excluded.sources,source_rank=excluded.source_rank,title_key=excluded.title_key''',
                    (identifier,journal['name'],', '.join(journal['groups']),entry['title'],entry['link'],'',entry['authors'],entry['abstract'],
                     entry['doi'] or None,entry['published_date'],previous['matched_date'] if previous else now(),journal['id'],entry['online_date'],entry['print_date'],
                     entry['article_type'],','.join(sorted(sources)),max(entry['source_rank'],previous['source_rank'] or 0) if previous else entry['source_rank'],normalized_title(entry['title'])))
                inserted+=not bool(previous)
        return inserted

    def export(self, registry, destination):
        with self.get_connection('history') as conn:
            rows=[dict(r) for r in conn.execute('SELECT entry_id AS id,journal_id,title,link,authors,abstract,doi,published_date,matched_date AS first_seen,online_date,print_date,article_type,sources FROM matched_entries ORDER BY published_date DESC,entry_id')]
        active={j['id'] for j in registry['journals'] if j.get('enabled',True)}
        rows=[r for r in rows if r['journal_id'] in active and not is_supplement(r['title'],r['doi'] or '')]
        health=self.health()
        journals=[]
        for j in registry['journals']:
            if j['id'] not in active: continue
            sources=(['crossref'] if j.get('crossref_enabled',True) else [])+(['rss'] if j.get('rss_url') else [])
            records=[health.get((j['id'],s),{'source':s,'last_attempt':None,'last_success':None,'error':None,'item_count':0}) for s in sources]
            errors=[r for r in records if r['error']]
            status='pending' if not any(r['last_attempt'] for r in records) else 'error' if len(errors)==len(records) else 'partial' if errors else 'ok'
            journals.append({**j,'health':records,'status':status,'article_count':sum(r['journal_id']==j['id'] for r in rows)})
        payload={'generated_at':now(),'ft50_version':registry['ft50_version'],'sources':registry['sources'],'journals':journals,'articles':rows}
        destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
        for item in (ROOT/'radar/web').iterdir():
            if item.is_file():shutil.copy2(item,destination/item.name)
        temp=destination/'data.json.tmp';temp.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8');temp.replace(destination/'data.json')
        return payload


_rate_lock=threading.Lock()
_last_request=0.0


def get(url, params=None):
    global _last_request
    for attempt in range(3):
        with _rate_lock:
            time.sleep(max(0,0.5-(time.monotonic()-_last_request)))
            _last_request=time.monotonic()
        try:
            response=requests.get(url,params=params,timeout=(10,35),headers={'User-Agent':'JournalRadar/1.0 (+https://github.com/linkingoscar/journal-radar)','Accept':'application/json, application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.1'})
            if response.status_code==429 or response.status_code>=500:
                if attempt<2:
                    try: delay=min(30,float(response.headers.get('Retry-After',2**(attempt+1))))
                    except ValueError: delay=2**(attempt+1)
                    time.sleep(delay);continue
            response.raise_for_status()
            return response
        except requests.RequestException:
            if attempt==2:raise
            time.sleep(2**attempt)
    raise RuntimeError('request attempts exhausted')


def collect_crossref(journal,last_success,attempt,days,getter=get):
    end=dt.datetime.fromisoformat(attempt)
    if last_success:
        start=dt.datetime.fromisoformat(last_success)-dt.timedelta(days=7)
        filters=f'from-update-date:{start.date()},until-update-date:{end.date()}'
    else:
        filters=f'from-pub-date:{(end-dt.timedelta(days=days)).date()},until-pub-date:{end.date()}'
    cursor='*';entries=[]
    for _ in range(50):
        response=getter(f"https://api.crossref.org/journals/{journal['issns'][0]}/works",params={'filter':filters,'rows':100,'cursor':cursor})
        data=response.json()['message']
        items=data['items']
        entries.extend(x for x in (normalize_crossref(item,journal) for item in items) if x)
        if len(items)<100:return entries
        next_cursor=data.get('next-cursor')
        if not next_cursor or next_cursor==cursor:raise ValueError('Crossref 分页未完成；下次重试，不推进同步时间')
        cursor=next_cursor
    raise ValueError('Crossref 超过单次 5000 条；需缩短同步区间')


def collect_rss(journal,getter=get):
    response=getter(journal['rss_url'])
    parsed=feedparser.parse(response.content)
    if not parsed.version: raise ValueError('返回内容不是有效 RSS/Atom')
    if parsed.bozo and not isinstance(parsed.bozo_exception,feedparser.CharacterEncodingOverride):
        raise ValueError('RSS 解析不完整：'+str(parsed.bozo_exception)[:100])
    return [x for x in (normalize_rss(entry,journal) for entry in parsed.entries) if x]


def sync(registry,store,days=90,workers=3):
    health=store.health();attempt=now()
    jobs=[]
    for j in registry['journals']:
        if not j.get('enabled',True): continue
        if j.get('crossref_enabled',True):jobs.append((j,'crossref'))
        if j.get('rss_url'):jobs.append((j,'rss'))
    def collect(job):
        j,source=job
        try:
            entries=collect_crossref(j,health.get((j['id'],source),{}).get('last_success'),attempt,days) if source=='crossref' else collect_rss(j)
            return j,source,entries,None
        except Exception as exc:return j,source,[],str(exc)[:240]
    successes=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for j,source,entries,error in pool.map(collect,jobs):
            if not error:
                try: added=store.ingest(j,entries);successes+=1
                except Exception as exc:error='保存失败：'+str(exc)[:180]
            store.record_health(j['id'],source,attempt,error,len(entries))
            print(f"{j['short_name']} [{source}] "+(error if error else f'{len(entries)} 条，新增 {added} 条'),flush=True)
    return successes


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['sync','build'])
    parser.add_argument('--registry',default=str(ROOT/'radar/journals.json'))
    parser.add_argument('--data-dir',default=str(ROOT/'radar-data'))
    parser.add_argument('--output',default=str(ROOT/'site'))
    parser.add_argument('--days',type=int,default=90)
    parser.add_argument('--workers',type=int,default=3)
    parser.add_argument('--group',default='')
    args=parser.parse_args()
    registry=json.loads(Path(args.registry).read_text(encoding='utf-8'))
    store=RadarStore(args.data_dir)
    success=None
    if args.command=='sync':
        selected={**registry,'journals':[j for j in registry['journals'] if not args.group or args.group in j['groups']]}
        success=sync(selected,store,args.days,args.workers)
    payload=store.export(registry,args.output)
    print(f"Exported {len(payload['articles'])} articles, {len(payload['journals'])} journals to {args.output}")
    if success==0:raise SystemExit('所有采集来源失败，保留历史数据并标记本次运行失败')


if __name__=='__main__':main()
