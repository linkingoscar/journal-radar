import datetime as dt
import json
from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).parent))
from run import RadarStore, normalize_crossref, normalize_rss, collect_crossref, collect_rss, doi_of

J={'id':'0021-9010','name':'Journal of Applied Psychology','groups':['core10','ft50'],'issns':['0021-9010','1939-1854']}
def paper(doi='10.1037/apl0001234',title='An example paper',abstract='A useful abstract'):
    return {'DOI':doi,'title':[title],'ISSN':['1939-1854'],'abstract':abstract,'author':[{'given':'A','family':'Researcher'}],'published-online':{'date-parts':[[2026,8,1]]},'published-print':{'date-parts':[[2026,10]]},'type':'journal-article'}

def test_doi_merge_updates_without_losing_abstract_or_first_seen(tmp_path):
    store=RadarStore(tmp_path)
    item=normalize_crossref(paper(doi='10.1037/APL0001234'),J)
    assert store.ingest(J,[item])==1
    with store.get_connection('history') as c: before=dict(c.execute('SELECT * FROM matched_entries').fetchone())
    updated=normalize_crossref(paper(title='An updated title',abstract=''),J)
    assert store.ingest(J,[updated])==0
    with store.get_connection('history') as c:
        rows=c.execute('SELECT * FROM matched_entries').fetchall()
    assert len(rows)==1 and rows[0]['title']=='An updated title'
    assert rows[0]['abstract']=='A useful abstract' and rows[0]['matched_date']==before['matched_date']
    assert rows[0]['published_date']=='2026-08-01' and rows[0]['print_date']=='2026-10-01'

def test_rss_promoted_to_doi_preserves_reading_identity(tmp_path):
    store=RadarStore(tmp_path)
    rss=normalize_rss({'title':'An example paper','link':'https://publisher.test/paper','summary':'Abstract'},J)
    store.ingest(J,[rss])
    with store.get_connection('history') as c: identifier=c.execute('SELECT entry_id FROM matched_entries').fetchone()[0]
    assert store.ingest(J,[normalize_crossref(paper(),J)])==0
    with store.get_connection('history') as c: row=c.execute('SELECT * FROM matched_entries').fetchone()
    assert row['entry_id']==identifier and row['doi']=='10.1037/apl0001234'
    assert row['sources']=='crossref,rss'

def test_different_dois_with_same_title_are_not_collapsed(tmp_path):
    store=RadarStore(tmp_path)
    assert store.ingest(J,[normalize_crossref(paper(doi='10.1000/a',title='Editorial'),J),normalize_crossref(paper(doi='10.1000/b',title='Editorial'),J)])==2


def test_generic_rss_titles_keep_separate_issues_and_link_updates(tmp_path):
    store=RadarStore(tmp_path)
    first=normalize_rss({'title':'Editorial','link':'https://publisher.test/issue1'},J)
    second=normalize_rss({'title':'Editorial','link':'https://publisher.test/issue2'},J)
    assert store.ingest(J,[first,second])==2
    updated={**first,'title':'Editorial: updated title'}
    assert store.ingest(J,[updated])==0
    with store.get_connection('history') as c:
        rows=c.execute('SELECT title FROM matched_entries').fetchall()
    assert {r['title'] for r in rows}=={'Editorial','Editorial: updated title'}

def test_reject_wrong_journal_and_ignore_reference_doi():
    wrong=paper();wrong['ISSN']=['1111-1111']
    with pytest.raises(ValueError):normalize_crossref(wrong,J)
    assert doi_of({'summary':'Prior work: https://doi.org/10.1000/another'})==''
    assert normalize_rss({'title':'bad','link':'javascript:alert(1)'},J) is None
    assert normalize_crossref(paper(doi='10.1037/apl0001234.supp',title='Supplemental Material for An example paper'),J) is None
    assert normalize_rss({'title':'Supplemental Material for A paper','link':'https://publisher.test/supp'},J) is None
    relative=normalize_rss({'title':'HBR article','link':'/2026/09/example'},{**J,'site_url':'https://hbr.org/'})
    assert relative['link']=='https://hbr.org/2026/09/example'

def test_failure_preserves_checkpoint_and_history(tmp_path):
    store=RadarStore(tmp_path);store.ingest(J,[normalize_crossref(paper(),J)])
    store.record_health(J['id'],'rss','2026-09-01T00:00:00+00:00',None,1)
    store.record_health(J['id'],'rss','2026-09-02T00:00:00+00:00','HTTP 403',0)
    health=store.health()[J['id'],'rss']
    assert health['last_success']=='2026-09-01T00:00:00+00:00' and health['error']=='HTTP 403'
    with store.get_connection('history') as c:assert c.execute('SELECT COUNT(*) FROM matched_entries').fetchone()[0]==1

class Response:
    def __init__(self,items,cursor='next'):self.items=items;self.cursor=cursor
    def json(self):return {'message':{'items':self.items,'next-cursor':self.cursor}}

def test_crossref_paginates_and_uses_update_window():
    calls=[]
    def getter(url,params):
        calls.append(params)
        return Response([paper(doi=f'10.1000/{i}') for i in range(100)]) if len(calls)==1 else Response([paper(doi='10.1000/last')])
    result=collect_crossref(J,'2026-09-10T00:00:00+00:00','2026-09-13T00:00:00+00:00',90,getter)
    assert len(result)==101 and calls[1]['cursor']=='next'
    assert 'from-update-date:2026-09-03' in calls[0]['filter'] and 'from-pub-date' not in calls[0]['filter']

def test_html_instead_of_rss_is_failure():
    class Html:content=b'<html><body>Sign in required</body></html>'
    with pytest.raises(ValueError):collect_rss({'rss_url':'https://publisher.test/rss'},lambda url:Html())

def test_registry_groups_and_identity():
    registry=json.loads((Path(__file__).parent/'journals.json').read_text(encoding='utf-8'))
    journals=registry['journals'];assert len(journals)==len({j['id'] for j in journals})
    assert len([j for j in journals if set(j['groups']) & {'core10','ft50','utd24'}])==55
    assert {g:sum(g in j['groups'] for j in journals) for g in ['core10','ft50','utd24']}=={'core10':10,'ft50':50,'utd24':24}
    hrm=next(j for j in journals if j['id']=='0090-4848');hrmj=next(j for j in journals if j['id']=='0954-5395')
    assert hrm['rss_url']!=hrmj['rss_url']
