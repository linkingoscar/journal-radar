import json
import threading
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
import requests
from desktop import import_cloud,effective_status,make_handler
from run import RadarStore,normalize_rss

J={'id':'0021-9010','name':'Journal of Applied Psychology','groups':['core10'],'issns':['0021-9010']}


def test_cloud_import_keeps_reading_identity_and_merges_local_rss(tmp_path):
    store=RadarStore(tmp_path)
    row={'id':'b'*64,'journal_id':J['id'],'title':'A meaningful article title','link':'https://doi.org/10.1000/paper','doi':'10.1000/paper','abstract':'An abstract','sources':'crossref','published_date':'2026-09','first_seen':'2026-08-30T10:00:00+00:00'}
    cloud={'journals':[J],'articles':[row]}
    assert import_cloud(store,{'journals':[J]},cloud)==1
    store.ingest(J,[normalize_rss({'title':row['title'],'link':row['link'],'summary':'New RSS abstract'},J)])
    assert import_cloud(store,{'journals':[J]},cloud)==0
    with store.get_connection('history') as c:
        records=c.execute('SELECT * FROM matched_entries').fetchall()
    assert len(records)==1 and records[0]['entry_id']==row['id']
    assert records[0]['matched_date']==row['first_seen']
    assert records[0]['abstract']=='An abstract' and records[0]['sources']=='crossref,rss'


def test_local_success_replaces_failed_cloud_rss_without_masking_crossref_failure():
    good={'source':'crossref','last_success':'2026-09-13','error':None}
    failed={'source':'rss','last_success':None,'error':'403'}
    local={'source':'rss','last_success':'2026-09-13','error':None}
    assert effective_status([good,failed],local)=='ok'
    assert effective_status([{**good,'error':'503'},failed],local)=='partial'
    assert effective_status([good,failed],{**local,'error':'403'})=='partial'


def test_loopback_api_rejects_cross_origin_rebinding_and_unauthenticated_mutations(tmp_path):
    calls=[]
    app=SimpleNamespace(token='test-secret',status={},directory=tmp_path,start_sync=lambda:calls.append(True) or True)
    app.abstract_article=lambda identifier:{'id':identifier} if identifier=='a'*64 else None
    app.pause_abstracts=lambda:True
    app.abstract_slot=threading.BoundedSemaphore(1)
    app.abstracts=SimpleNamespace(lookup=lambda article:calls.append(article['id']) or {'status':'found','abstract':'An existing abstract'})
    app.abstracts.overlay=lambda result:result
    app.archive_slot=threading.BoundedSemaphore(1)
    app.archives=SimpleNamespace(overview=lambda jid:{'journal_id':jid},year=lambda jid,year,**kwargs:{'articles':[],'year':year})
    server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(app,0))
    port=server.server_port;server.RequestHandlerClass=make_handler(app,port)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url=f'http://127.0.0.1:{port}'
    try:
        assert requests.get(url+'/api/session').json()['app']=='journal-radar-desktop'
        for cover,mime in [('cover-0001-4273.jpg','image/jpeg'),('cover-0001-8392.webp','image/webp'),('cover-1572-3097.jpeg','image/jpeg')]:
            image=requests.get(url+'/'+cover)
            assert image.status_code==200 and image.headers['Content-Type']==mime
            assert image.content.startswith((b'\xff\xd8',b'RIFF'))
        assert requests.get(url+'/api/session',headers={'Origin':'https://untrusted.test'}).status_code==403
        assert requests.get(url+'/api/session',headers={'Host':f'untrusted.test:{port}'}).status_code==403
        assert requests.get(url+'/%2e%2e/radar/desktop.py').status_code==404
        assert requests.post(url+'/api/sync').status_code==403
        assert requests.post(url+'/api/sync',headers={'Origin':'https://untrusted.test','X-Radar-Token':app.token}).status_code==403
        assert calls==[]
        assert requests.post(url+'/api/sync',headers={'Origin':url,'X-Radar-Token':app.token}).status_code==202
        assert calls==[True]
        endpoint=url+'/api/abstract/'+'a'*64
        assert requests.post(endpoint).status_code==403
        assert requests.post(endpoint,headers={'X-Radar-Token':app.token,'Origin':'https://untrusted.test'}).status_code==403
        assert requests.post(endpoint,headers={'X-Radar-Token':app.token},data='https://untrusted.test').status_code==400
        assert requests.post(url+'/api/abstract/'+'c'*64,headers={'X-Radar-Token':app.token}).status_code==404
        assert requests.post(endpoint,headers={'X-Radar-Token':app.token}).json()['status']=='found'
        assert calls==[True,'a'*64]
        assert requests.post(url+'/api/abstracts/pause').status_code==403
        assert requests.post(url+'/api/abstracts/pause',headers={'X-Radar-Token':app.token,'Origin':'https://untrusted.test'}).status_code==403
        assert requests.post(url+'/api/abstracts/pause',headers={'X-Radar-Token':app.token}).json()['paused']
        archive=url+'/api/archive/0021-9010'
        assert requests.get(archive).status_code==404
        assert requests.post(archive).status_code==403
        assert requests.post(archive,headers={'X-Radar-Token':app.token,'Origin':'https://untrusted.test'}).status_code==403
        assert requests.post(archive+'?year=1980',headers={'X-Radar-Token':app.token}).json()['year']==1980
        assert requests.post(archive+'?year=wrong',headers={'X-Radar-Token':app.token}).status_code==400
        assert requests.post(archive+'?year=1980&year=1981',headers={'X-Radar-Token':app.token}).status_code==400
        assert requests.post(archive+'?url=https://untrusted.test',headers={'X-Radar-Token':app.token}).status_code==400
        app.archive_slot.acquire()
        assert requests.post(archive,headers={'X-Radar-Token':app.token}).status_code==429
        app.archive_slot.release()
    finally:server.shutdown();server.server_close();thread.join()


def test_sync_runs_abstract_queue_and_publishes_results(tmp_path,monkeypatch):
    from desktop import Companion
    from run import now
    app=Companion(tmp_path)
    app.registry={**app.registry,'journals':[J]}
    cloud={'generated_at':now(),'journals':[J],'articles':[]}
    monkeypatch.setattr('desktop.get',lambda _:SimpleNamespace(json=lambda:cloud))
    def enrich(payload,stop,progress):
        assert payload['articles']==[] and not stop.is_set()
        progress({'stage':'pages','checked':0,'total':1,'found':0})
        assert app.pause_abstracts() and stop.is_set()
        return {'found':0,'remaining':0,'paused':True}
    monkeypatch.setattr(app.abstracts,'enrich',enrich)
    app.status['running']=True
    app.sync()
    assert not app.status['running'] and app.status['paused'] and app.status['error'] is None
    assert json.loads((tmp_path/'abstract-progress.json').read_text(encoding='utf-8'))['paused']


def test_cancelled_browser_request_does_not_retry_writing_to_closed_connection():
    handler=object.__new__(make_handler(SimpleNamespace(),8766))
    handler.send_response=lambda status:None
    handler.send_header=lambda key,value:None
    def closed():raise ConnectionAbortedError('Browser switched years')
    handler.end_headers=closed
    assert handler.respond(200,{'complete':False}) is None


def test_desktop_retries_failed_crossref_and_exposes_local_health(tmp_path,monkeypatch):
    from desktop import Companion
    from run import now
    app=Companion(tmp_path);app.registry={**app.registry,'journals':[J]}
    cloud={'generated_at':now(),'journals':[{**J,'health':[{'source':'crossref','error':'429','last_success':now()}]}],'articles':[]}
    monkeypatch.setattr('desktop.get',lambda _:SimpleNamespace(json=lambda:cloud))
    calls=[]
    monkeypatch.setattr('desktop.collect_crossref',lambda journal,last,attempt,days:calls.append((journal['id'],last)) or [])
    monkeypatch.setattr(app.abstracts,'enrich',lambda *args:{'found':0,'remaining':0,'paused':False})
    app.sync()
    assert len(calls)==1 and calls[0][1]
    payload=json.loads((tmp_path/'site/data.json').read_text(encoding='utf-8'))
    assert payload['journals'][0]['status']=='ok'
    assert any(h['source']=='本机 Crossref' and not h['error'] for h in payload['journals'][0]['health'])
