"""Loopback-only companion: cloud history plus RSS collected on this computer."""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit
from run import ROOT, RadarStore, collect_rss, get, now, plain, safe_url
from abstracts import AbstractService

PORT=8766
CLOUD='https://linkingoscar.github.io/journal-radar/data.json'


def import_cloud(store, registry, payload):
    if not isinstance(payload,dict) or not isinstance(payload.get('articles'),list) or not isinstance(payload.get('journals'),list):
        raise ValueError('云端数据格式错误')
    byid={j['id']:j for j in registry['journals']}
    grouped={}
    for row in payload['articles']:
        jid=row.get('journal_id')
        if jid not in byid or not row.get('title') or not safe_url(row.get('link')):continue
        sources=set((row.get('sources') or 'crossref').split(',')) & {'crossref','rss'}
        for source in sources:
            entry={key:plain(row.get(key)) for key in ('title','authors','abstract','doi','published_date','online_date','print_date','article_type')}
            entry.update(link=safe_url(row['link']),entry_id=row.get('id',''),first_seen=row.get('first_seen'),source=source,source_rank=2 if 'crossref' in sources else 1)
            grouped.setdefault(jid,[]).append(entry)
    added=sum(store.ingest(byid[jid],entries) for jid,entries in grouped.items())
    return added


def effective_status(cloud, local):
    # A working local RSS feed replaces a rejected cloud RSS request in availability.
    effective={h['source']:h for h in cloud}
    if local and (not local.get('error') or not effective.get('rss',{}).get('last_success')):
        effective['rss']=local
    values=list(effective.values())
    good=any(h.get('last_success') and not h.get('error') for h in values)
    bad=any(h.get('error') for h in values)
    return 'partial' if good and bad else 'ok' if good else 'error' if bad else 'pending'


class Companion:
    def __init__(self,directory):
        self.directory=Path(directory);self.directory.mkdir(parents=True,exist_ok=True)
        self.registry=json.loads((ROOT/'radar/journals.json').read_text(encoding='utf-8'))
        self.store=RadarStore(self.directory)
        self.abstracts=AbstractService(self.directory)
        self.abstract_slot=threading.BoundedSemaphore(1)
        self.token=secrets.token_urlsafe(32)
        self.guard=threading.Lock()
        self.status={'running':False,'phase':'等待补采','completed':0,'total':0,'last_finished':None,'error':None}
        self.cloud={}
        try:self.cloud=json.loads((self.directory/'cloud.json').read_text(encoding='utf-8'))
        except (FileNotFoundError,ValueError):pass
        self.publish()

    def publish(self):
        payload=self.store.export(self.registry,self.directory/'site')
        self.abstracts.overlay(payload)
        cloud_abstracts={a.get('doi'):a for a in self.cloud.get('articles',[]) if a.get('doi') and a.get('abstract_source')}
        for article in payload['articles']:
            source=cloud_abstracts.get(article.get('doi'))
            if source and source.get('abstract')==article.get('abstract'):
                article.update(abstract_source=source['abstract_source'],abstract_url=source.get('abstract_url',''))
        cloud_journals={j['id']:j for j in self.cloud.get('journals',[])}
        local_health=self.store.health()
        for j in payload['journals']:
            c=cloud_journals.get(j['id'],{}).get('health',[])
            local=local_health.get((j['id'],'rss'))
            j['status']=effective_status(c,local)
            j['health']=[{**h,'source':'云端 '+h['source']} for h in c]+([{**local,'source':'本机 RSS'}] if local else [])
        # Keep reading state when a cloud record and an earlier local RSS entry have different ids.
        doi_ids={a['doi']:a['id'] for a in payload['articles'] if a['doi']}
        link_ids={(a['journal_id'],a['link']):a['id'] for a in payload['articles']}
        aliases={}
        for a in self.cloud.get('articles',[]):
            canonical=doi_ids.get(a.get('doi')) or link_ids.get((a.get('journal_id'),a.get('link')))
            if canonical and canonical!=a.get('id'):aliases[a['id']]=canonical
        payload.update(desktop=True,cloud_updated_at=self.cloud.get('generated_at'),reading_aliases=aliases)
        temp=self.directory/'site/data.json.tmp'
        temp.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        temp.replace(self.directory/'site/data.json')
        self.status['data_revision']=payload['generated_at']
        self.status['articles']=len(payload['articles'])

    def abstract_article(self,identifier):
        with self.store.get_connection('history') as c:
            row=c.execute('SELECT entry_id AS id,title,doi,link,abstract,journal_id FROM matched_entries WHERE entry_id=?',(identifier,)).fetchone()
        return dict(row) if row else None

    def start_sync(self):
        with self.guard:
            if self.status['running']:return False
            self.status.update(running=True,phase='正在读取云端文章',completed=0,total=0,error=None)
        threading.Thread(target=self.sync,daemon=True,name='journal-radar-sync').start()
        return True

    def sync(self):
        try:
            cloud_failed=False
            try:
                payload=get(CLOUD).json()
                if payload.get('generated_at')!=self.cloud.get('generated_at'):
                    import_cloud(self.store,self.registry,payload)
                    temp=self.directory/'cloud.json.tmp'
                    temp.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
                    temp.replace(self.directory/'cloud.json')
                    self.cloud=payload
                self.publish()
            except Exception as exc:
                cloud_failed=True
                self.status['error']='读取云端失败，继续使用本机历史：'+str(exc)[:160]
            byid={j['id']:j for j in self.cloud.get('journals',[])}
            cloud_stamp=self.cloud.get('generated_at')
            stale=not cloud_stamp or (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(cloud_stamp)).total_seconds()>86400
            jobs=[]
            for j in self.registry['journals']:
                if not j.get('enabled',True) or not j.get('rss_url'):continue
                h=next((h for h in byid.get(j['id'],{}).get('health',[]) if h['source']=='rss'),{})
                if cloud_failed or stale or not h.get('last_success') or h.get('error'):jobs.append(j)
            self.status.update(phase='正在补采出版商 RSS',total=len(jobs))
            attempt=now()
            def fetch(j):
                try:return j,collect_rss(j),None
                except Exception as exc:return j,[],str(exc)[:200]
            failed=0
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                for j,entries,error in pool.map(fetch,jobs):
                    if not error:self.store.ingest(j,entries)
                    else:failed+=1
                    self.store.record_health(j['id'],'rss',attempt,error,len(entries))
                    self.status['completed']+=1
            self.publish()
            self.status['phase']=f'补采完成：{len(jobs)-failed}/{len(jobs)} 个来源成功' if jobs else '云端来源正常，暂不需要补采'
        except Exception as exc:
            self.status.update(phase='本次补采未完成',error=str(exc)[:200])
        finally:self.status.update(running=False,last_finished=now())


def make_handler(app,port):
    origin=f'http://127.0.0.1:{port}'
    files={p.name for p in (ROOT/'radar/web').iterdir() if p.is_file()}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def trusted(self):
            return self.headers.get('Host')==f'127.0.0.1:{port}' and self.headers.get('Origin',origin)==origin and self.headers.get('Sec-Fetch-Site','same-origin') not in ('cross-site','same-site')
        def respond(self,status,body,content_type='application/json; charset=utf-8'):
            if not isinstance(body,bytes):body=json.dumps(body,ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Referrer-Policy','no-referrer')
            self.send_header('Content-Security-Policy',"frame-ancestors 'none'")
            self.end_headers();self.wfile.write(body)
        def do_GET(self):
            if not self.trusted():return self.respond(403,{'error':'仅允许本机应用访问'})
            path=urlsplit(self.path).path
            if path=='/api/session':return self.respond(200,{'app':'journal-radar-desktop','version':1,'token':app.token,**app.status})
            if path=='/data.json':return self.respond(200,app.abstracts.overlay(json.loads((app.directory/'site/data.json').read_text(encoding='utf-8'))))
            name='index.html' if path=='/' else path[1:]
            if name not in files:return self.respond(404,{'error':'Not found'})
            suffix=Path(name).suffix
            mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.webmanifest':'application/manifest+json'}.get(suffix,'application/octet-stream')
            return self.respond(200,(ROOT/'radar/web'/name).read_bytes(),mime)
        def do_POST(self):
            if not self.trusted() or not secrets.compare_digest(self.headers.get('X-Radar-Token',''),app.token):return self.respond(403,{'error':'无效的本机请求'})
            if self.headers.get('Content-Length','0')!='0':return self.respond(400,{'error':'请求不应包含正文'})
            path=urlsplit(self.path).path
            if path=='/api/sync':return self.respond(202,{'started':app.start_sync()})
            match=re.fullmatch(r'/api/abstract/([a-f0-9]{64})',path)
            if not match:return self.respond(404,{'error':'Not found'})
            article=app.abstract_article(match[1])
            if not article:return self.respond(404,{'error':'文章未收录，请先刷新文章'})
            if not app.abstract_slot.acquire(blocking=False):return self.respond(429,{'error':'另一篇摘要正在补取，请稍后重试。'})
            try:
                result=app.abstracts.lookup(article)
                return self.respond(200,result)
            except Exception:
                return self.respond(500,{'error':'摘要补取暂时失败，请稍后重试。'})
            finally:app.abstract_slot.release()
    return Handler


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',default=str(ROOT/'.desktop-data'));parser.add_argument('--port',type=int,default=PORT)
    args=parser.parse_args()
    # Bind before touching files: launching twice cannot start two writers on the same database.
    server=ThreadingHTTPServer(('127.0.0.1',args.port),BaseHTTPRequestHandler)
    app=Companion(args.data_dir);server.RequestHandlerClass=make_handler(app,args.port)
    app.start_sync()
    server.serve_forever()


if __name__=='__main__':main()
