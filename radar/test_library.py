import copy
import json
import socket
import threading
import time
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
import pytest
import requests
from library import Library, lookup, public_feed_get, public_target
from desktop import Companion, make_handler
from run import ROOT, normalize_rss

J={'id':'0093-5301','name':'Journal of Consumer Research','issns':['0093-5301','1537-5277'],'groups':['ft50','marketing']}
BASE={'journals':[J],'groups':[{'id':'marketing','name':'Marketing','journal_ids':[J['id']]}]}


def test_groups_membership_rename_delete_restart_and_new_seed(tmp_path):
    path=tmp_path/'library.json';lib=Library(BASE,path)
    groups=[{'id':'marketing','name':'消费者研究','journal_ids':[]},{'id':'g-second','name':'第二组','journal_ids':[J['id']]}]
    lib.save_groups(groups)
    loaded=Library(BASE,path)
    assert loaded.registry()['groups']==groups
    assert loaded.registry()['journals'][0]['groups']==['ft50','g-second']
    loaded.save_groups([])
    updated={**copy.deepcopy(BASE),'groups':[*BASE['groups'],{'id':'new-seed','name':'New seed','journal_ids':[J['id']]}]}
    restarted=Library(updated,path).registry()
    assert [g['id'] for g in restarted['groups']]==['new-seed']
    assert restarted['journals'][0]['groups']==['ft50','new-seed']
    assert BASE['journals'][0]['groups']==['ft50','marketing']


def test_issn_alias_dedup_and_atomic_validation(tmp_path,monkeypatch):
    lib=Library(BASE,tmp_path/'library.json')
    alias={**J,'id':'1537-5277','issns':['1537-5277','0093-5301']}
    journal,existing=lib.add(alias,'marketing')
    assert existing and journal['id']==J['id'] and len(lib.registry()['journals'])==1
    before=copy.deepcopy(lib.local)
    with pytest.raises(ValueError):lib.save_groups([{'id':'g-invalid','name':'Broken','journal_ids':['missing']}])
    assert lib.local==before
    with pytest.raises(ValueError):lib.add(alias,'missing')
    monkeypatch.setattr(type(lib.path),'replace',lambda *a:(_ for _ in ()).throw(OSError('disk full')))
    with pytest.raises(OSError):lib.save_groups([])
    assert lib.local==before and Library(BASE,lib.path).local==before


def test_lookup_existing_and_rss_without_crossref():
    def no_network(*a,**k):pytest.fail('Existing ISSN must not need Crossref')
    assert lookup('15375277',BASE,getter=no_network)[0]['id']==J['id']
    with pytest.raises(ValueError):lookup('0093-5302',BASE,getter=no_network)
    feed=b'<rss version="2.0"><channel><title>Example Research</title><link>https://example.org</link><description>Research</description><item><title>A paper</title><link>https://example.org/paper</link></item></channel></rss>'
    def unavailable(*a,**k):raise requests.Timeout()
    candidate=lookup('https://example.org/feed',BASE,getter=unavailable,feed_getter=lambda _:SimpleNamespace(content=feed))[0]
    assert candidate['id'].startswith('rss-') and candidate['crossref_enabled'] is False and candidate['issns']==[]
    assert normalize_rss({'title':'A paper','link':'https://example.org/paper'},candidate)['title']=='A paper'


def test_public_rss_pins_validated_ip_and_rejects_private_redirect(monkeypatch):
    connections=[]
    monkeypatch.setattr(socket,'getaddrinfo',lambda host,*a,**k:[(2,1,6,'',('127.0.0.1' if host=='localhost' else '93.184.216.34',443))])
    class Pool:
        def __init__(self,host,**kw):connections.append((host,kw))
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def urlopen(self,*a,**kw):
            return SimpleNamespace(status=302,headers={'Location':'http://localhost/private'},close=lambda:None)
    monkeypatch.setattr('library.urllib3.HTTPSConnectionPool',Pool)
    with pytest.raises(ValueError,match='公网'):public_feed_get('https://example.org/feed')
    assert len(connections)==1 and connections[0][0]=='93.184.216.34'
    assert connections[0][1]['server_hostname']==connections[0][1]['assert_hostname']=='example.org'
    with pytest.raises(ValueError):public_feed_get('file:///etc/passwd')


def test_proxy_synthetic_dns_uses_verified_public_answer_and_still_blocks_private(monkeypatch):
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a,**k:[(2,1,6,'',('198.18.0.12',443))])
    answer={'Status':0,'Answer':[{'type':1,'data':'93.184.216.34'}]}
    calls=[]
    def resolve(url,**kwargs):
        calls.append((url,kwargs))
        return SimpleNamespace(raise_for_status=lambda:None,json=lambda:answer)
    monkeypatch.setattr('library.requests.get',resolve)
    assert public_target('https://example.org/feed')[2]=='93.184.216.34'
    assert calls[0][0]=='https://dns.google/resolve' and calls[0][1]['params']['name']=='example.org'
    answer['Answer'][0]['data']='127.0.0.1'
    with pytest.raises(ValueError):public_target('https://example.org/feed')


def test_authenticated_library_api_preserves_reading_and_rejects_stale_writes(tmp_path,monkeypatch):
    app=Companion(tmp_path)
    app.store.ingest(J,[normalize_rss({'title':'Saved research','link':'https://example.org/paper'},J)])
    monkeypatch.setattr(app,'start_sync_unlocked',lambda:True)
    server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(app,0));port=server.server_port
    server.RequestHandlerClass=make_handler(app,port)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url=f'http://127.0.0.1:{port}/api/library/';headers={'X-Radar-Token':app.token}
    try:
        assert requests.post(url+'lookup',json={'query':J['id']}).status_code==403
        assert requests.post(url+'groups',headers={**headers,'Origin':'https://evil.example'},json={}).status_code==403
        assert requests.post(url+'groups',headers=headers,data='{}').status_code==400
        assert requests.post(url+'groups',headers=headers,json=[]).status_code==400
        revision=app.library_revision();groups=[*app.registry['groups'],{'id':'g-test','name':'多组测试','journal_ids':[]}]
        assert requests.post(url+'groups',headers=headers,json={'groups':groups,'revision':revision}).status_code==200
        assert requests.post(url+'groups',headers=headers,json={'groups':[],'revision':revision}).status_code==400
        candidate=requests.post(url+'lookup',headers=headers,json={'query':'1537-5277'}).json()['journals'][0]
        result=requests.post(url+'journals',headers=headers,json={'candidate':candidate['candidate'],'group_id':'g-test','revision':app.library_revision()}).json()
        assert result=={'journal_id':J['id'],'existing':True}
        assert next(g for g in app.registry['groups'] if g['id']=='g-test')['journal_ids']==[J['id']]
        assert len(app.registry['journals'])==95 and app.archives.journals[J['id']]
        bad=requests.post(url+'journals',headers=headers,json={'candidate':'forged','revision':app.library_revision()})
        assert bad.status_code==400
        assert requests.post(url+'groups',headers=headers,json={'groups':app.registry['groups'][:-1],'revision':app.library_revision()}).status_code==200
        with app.store.get_connection('history') as connection:
            assert connection.execute('SELECT title FROM matched_entries').fetchone()['title']=='Saved research'
    finally:server.shutdown();server.server_close();thread.join()


def test_new_journal_reaches_archives_and_is_collected_without_cloud_entry(tmp_path,monkeypatch):
    app=Companion(tmp_path)
    journal={'id':'1476-4687','name':'Nature','issns':['1476-4687'],'groups':[],'enabled':True,'rss_url':None}
    app.candidates['verified']=(time.monotonic()+100,journal)
    started=[];monkeypatch.setattr(app,'start_sync_unlocked',lambda:started.append(True))
    app.change_library('journals',{'candidate':'verified','revision':app.library_revision()})
    assert started and app.archives.journals[journal['id']]['user_added']
    app.registry={**app.registry,'journals':[app.archives.journals[journal['id']]]}
    monkeypatch.setattr('desktop.get',lambda _:SimpleNamespace(json=lambda:{'journals':[],'articles':[]}))
    calls=[]
    monkeypatch.setattr('desktop.collect_crossref',lambda j,*a:calls.append(j['id']) or [])
    monkeypatch.setattr(app.abstracts,'enrich',lambda *a:{'found':0,'remaining':0,'paused':False})
    app.sync()
    assert calls==[journal['id']]
    exported=json.loads((tmp_path/'site/data.json').read_text(encoding='utf-8'))
    assert exported['journals'][0]['status']=='ok'
    assert any(j['id']==journal['id'] for j in Companion(tmp_path).registry['journals'])


def test_consumer_marketing_seed_matches_all_requested_journals():
    registry=json.loads((ROOT/'radar/journals.json').read_text(encoding='utf-8'))
    group=next(g for g in registry['groups'] if g['id']=='consumer-marketing')
    expected=['0093-5301','1057-7408','0022-2437','0022-2429','0092-0703','0167-8116','0022-4359','0749-5978','0022-3514','0956-7976','2378-1815','0742-6046','1472-0817','0923-0645','0091-3367','1094-9968','0743-9156','0309-0566','0265-1335','0148-2963','0969-6989','1350-231X','1470-6423','0265-0487','0747-5632']
    assert group['journal_ids']==expected
    selected=[j for j in registry['journals'] if group['id'] in j['groups']]
    assert {j['id'] for j in selected}==set(expected)
    assert all(j['enabled'] and j['crossref_identity_verified'] for j in selected)
