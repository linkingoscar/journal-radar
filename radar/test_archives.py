import hashlib
from types import SimpleNamespace
import pytest
from archives import ArchiveService, normalize_archive
from run import RadarStore

J={'id':'0021-9010','issns':['0021-9010'],'name':'Journal of Applied Psychology','groups':['hr35']}


def record(doi='10.1000/study', **fields):
    return {'DOI':doi,'title':['How leaders support wellbeing at work'],'ISSN':J['issns'],
            'type':'journal-article','volume':'65','issue':'1','page':'21-35',
            'published-print':{'date-parts':[[1980,1]]},'published-online':{'date-parts':[[1979,12]]},**fields}


def service(tmp_path,getter):
    RadarStore(tmp_path)
    return ArchiveService(tmp_path,{'journals':[J]},getter)


def response(items,cursor='next'):
    return SimpleNamespace(json=lambda:{'message':{'items':items,'next-cursor':cursor}})


def test_archive_year_uses_print_year_and_preserves_volume_only_and_combined_issues():
    a=normalize_archive(record(issue='1/2'),J)
    assert a['archive_year']==1980 and a['published_date']=='1979-12' and a['issue']=='1/2'
    a=normalize_archive(record(issue='',page='',**{'article-number':'e123'}),J)
    assert a['volume']=='65' and a['issue']=='' and a['article_number']=='e123'
    a=normalize_archive(record(volume='',issue='',**{'published-print':{},'published-online':{'date-parts':[[2026,9]]}}),J)
    assert a['archive_year']==2026 and a['year_basis']=='publication'
    with pytest.raises(ValueError):normalize_archive(record(ISSN=['0000-0000']),J)


def test_opening_service_does_not_fetch_and_year_pages_resume_after_failure(tmp_path,monkeypatch):
    monkeypatch.setattr('archives.PAGE_SIZE',2)
    calls=[]
    replies=[response([record('10.1000/a'),record('10.1000/b')]),RuntimeError('offline'),response([]),response([])]
    def getter(url,params):
        calls.append(params)
        result=replies.pop(0)
        if isinstance(result,Exception):raise result
        return result
    archive=service(tmp_path,getter)
    assert calls==[]
    first=archive.year(J['id'],1980)
    assert len(first['articles'])==2 and not first['complete']
    with pytest.raises(RuntimeError):archive.year(J['id'],1980,advance=True)
    restored=ArchiveService(tmp_path,{'journals':[J]},getter)
    assert len(restored.year(J['id'],1980)['articles'])==2 and len(calls)==2
    restored.year(J['id'],1980,advance=True)
    assert restored.year(J['id'],1980,advance=True)['complete']
    assert calls[1]['cursor']==calls[2]['cursor']=='next'
    assert 'from-print-pub-date' in calls[0]['filter'] and 'from-pub-date' in calls[-1]['filter']
    assert len(restored.year(J['id'],1980)['articles'])==2 and len(calls)==4


def test_archive_deduplicates_phases_filters_year_and_keeps_feed_identity(tmp_path):
    store=RadarStore(tmp_path)
    item=record()
    from run import normalize_crossref
    store.ingest(J,[{**normalize_crossref(item,J),'entry_id':'b'*64}])
    replies=[response([item]),response([item,record('10.1000/other',**{'published-print':{'date-parts':[[1981,1]]}})])]
    archive=ArchiveService(tmp_path,{'journals':[J]},lambda url,params:replies.pop(0))
    first=archive.year(J['id'],1980)
    result=archive.year(J['id'],1980,advance=True)
    assert result['complete'] and len(result['articles'])==1
    assert result['articles'][0]['id']=='b'*64
    hashed=hashlib.sha256(item['DOI'].encode()).hexdigest()
    assert result['reading_aliases']=={hashed:'b'*64}
    assert archive.article(hashed)['doi']==item['DOI']
    with store.get_connection('history') as c:
        assert c.execute('SELECT COUNT(*) FROM matched_entries').fetchone()[0]==1


def test_overview_is_cached_and_refresh_failure_preserves_completed_year(tmp_path):
    calls=[]
    def getter(url,params):calls.append(params);return response([record()])
    archive=service(tmp_path,getter)
    assert archive.overview(J['id'])['first_year']==1979
    assert archive.overview(J['id'])['last_year']==1980 and len(calls)==2
    archive.year(J['id'],1980);archive.year(J['id'],1980,advance=True)
    def fail(*args,**kwargs):raise RuntimeError('offline')
    archive.getter=fail
    with pytest.raises(RuntimeError):archive.year(J['id'],1980,refresh=True)
    assert archive.year(J['id'],1980)['complete']
    with pytest.raises(ValueError):archive.year('0000-0000',1980)
    with pytest.raises(ValueError):archive.year(J['id'],1499)


def test_repeated_source_page_stops_without_discarding_cache(tmp_path,monkeypatch):
    monkeypatch.setattr('archives.PAGE_SIZE',1)
    archive=service(tmp_path,lambda url,params:response([record()]))
    archive.year(J['id'],1980)
    with pytest.raises(ValueError,match='重复'):archive.year(J['id'],1980,advance=True)
    assert len(archive.year(J['id'],1980)['articles'])==1


def test_refresh_removes_old_directory_members_only_after_success_and_retains_paper(tmp_path):
    replies=[response([record()]),response([]),response([]),RuntimeError('offline'),response([])]
    def getter(url,params):
        value=replies.pop(0)
        if isinstance(value,Exception):raise value
        return value
    archive=service(tmp_path,getter)
    archive.year(J['id'],1980);before=archive.year(J['id'],1980,advance=True)
    identifier=before['articles'][0]['id']
    assert len(archive.year(J['id'],1980,refresh=True)['articles'])==1
    with pytest.raises(RuntimeError):archive.year(J['id'],1980,advance=True)
    assert len(archive.year(J['id'],1980)['articles'])==1
    assert archive.year(J['id'],1980,advance=True)['articles']==[]
    assert archive.article(identifier)['title']==record()['title'][0]


def test_year_correction_moves_cached_paper_to_its_print_year(tmp_path):
    changed=record(**{'published-print':{'date-parts':[[1981]]}})
    replies=[response([record()]),response([]),response([]),response([changed])]
    archive=service(tmp_path,lambda url,params:replies.pop(0))
    first=archive.year(J['id'],1980);archive.year(J['id'],1980,advance=True)
    archive.year(J['id'],1980,refresh=True)
    assert archive.year(J['id'],1980,advance=True)['articles']==[]
    assert archive.article(first['articles'][0]['id'])['archive_year']==1981


def test_full_final_page_without_cursor_is_complete_when_total_confirms_end(tmp_path,monkeypatch):
    monkeypatch.setattr('archives.PAGE_SIZE',1)
    values=[SimpleNamespace(json=lambda:{'message':{'items':[record()],'total-results':1}}),response([])]
    archive=service(tmp_path,lambda url,params:values.pop(0))
    assert len(archive.year(J['id'],1980)['articles'])==1
    assert archive.year(J['id'],1980,advance=True)['complete']


def test_apa_alias_merge_requires_matching_identity_and_preserves_reading_aliases(tmp_path):
    a=record('10.1037//0021-9010.65.1.1',author=[{'given':'A','family':'Researcher'}])
    b={**a,'DOI':'10.1037/0021-9010.65.1.1','published-print':{},'published-online':{'date-parts':[[1980]]}}
    store=RadarStore(tmp_path)
    from run import normalize_crossref
    store.ingest(J,[{**normalize_crossref(a,J),'entry_id':'b'*64}])
    archive=ArchiveService(tmp_path,{'journals':[J]},lambda url,params:response([a,b]))
    result=archive.year(J['id'],1980)
    assert len(result['articles'])==1 and result['articles'][0]['doi']==b['DOI']
    assert result['articles'][0]['print_date']=='1980-01'
    assert result['reading_aliases']['b'*64]==result['articles'][0]['id']
    from archives import merge_apa_aliases
    different=normalize_archive({**b,'title':['An entirely different paper']},J)
    assert len(merge_apa_aliases([normalize_archive(a,J),different])[0])==2
