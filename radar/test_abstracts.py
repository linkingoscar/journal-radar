import json
from types import SimpleNamespace

import pytest
from abstracts import AbstractService, allowed_url, fetch, from_html, from_openalex, readable_abstract

A={'id':'a'*64,'doi':'10.1000/study','title':'How supportive leadership improves employee wellbeing',
   'link':'https://doi.org/10.1000/study','abstract':'Publication date: September 2026Source: A Journal, Volume 9Author(s): Researcher'}
TEXT=('We examined how supportive leadership affects employee wellbeing across different organizational contexts. '
      'Our longitudinal study found that consistent support improves engagement and reduces employee turnover over time.')


def work(article=A):
    index={}
    for i,word in enumerate(TEXT.split()):index.setdefault(word,[]).append(i)
    return {'id':'https://openalex.org/W123','doi':'https://doi.org/'+article['doi'],'title':article['title'],'abstract_inverted_index':index}


def test_metadata_is_not_an_abstract_and_index_requires_exact_identity_and_complete_positions():
    assert not readable_abstract(A['abstract'])
    assert readable_abstract(A['abstract']+' Abstract '+TEXT)==TEXT
    assert not readable_abstract('A Journal, Volume 9, Issue 2')
    assert from_openalex(work(),A)==TEXT
    assert not from_openalex({**work(),'doi':'10.1000/other'},A)
    assert not from_openalex({**work(),'title':'A completely different research paper'},A)
    assert not from_openalex({**work(),'abstract_inverted_index':{'bad':[900000000]}},A)
    assert not from_openalex({**work(),'abstract_inverted_index':{'missing':[1]}},A)


def test_html_only_accepts_matching_article_abstracts_not_related_articles_or_teasers():
    metadata='<meta name="citation_doi" content="10.1000/study">'
    assert from_html(metadata+'<section id="abstract"><h2>Abstract</h2><p>'+TEXT+'</p></section>',A)==TEXT
    assert from_html(metadata+'<meta name="citation_abstract" content="'+TEXT+'">',A)==TEXT
    assert not from_html(metadata.replace('10.1000/study','10.1000/other')+'<div class="abstract">'+TEXT+'</div>',A)
    assert not from_html('<meta property="og:description" content="'+TEXT+'"><div>'+TEXT+'</div>',A)
    assert not from_html(metadata+'<div class="abstract">'+TEXT+'...</div>',A)
    ld={'@type':'ScholarlyArticle','headline':A['title'],'abstract':TEXT}
    assert from_html('<script type="application/ld+json">'+json.dumps(ld)+'</script>',A)==TEXT
    assert not from_html('<script type="application/ld+json">'+json.dumps({**ld,'headline':'Another study'})+'</script>',A)


def test_batch_persists_and_overlays_without_overwriting_source_abstract(tmp_path):
    calls=[]
    def getter(url):calls.append(url);return json.dumps({'results':[work()]}),url
    service=AbstractService(tmp_path,getter)
    assert service.batch({'articles':[A]},500)=={'checked':1,'found':1}
    assert service.batch({'articles':[A]},500)=={'checked':0,'found':0}
    restored=AbstractService(tmp_path,lambda url:pytest.fail('Cache should avoid network'))
    result=restored.overlay({'articles':[dict(A)]})['articles'][0]
    assert result['abstract']==TEXT and result['abstract_source']=='OpenAlex'
    assert restored.lookup(A)['cached']
    # A concurrent failure must not erase a successful result.
    restored.save(A,{'abstract':'','status':'unavailable'})
    assert restored.cached(A)['abstract']==TEXT
    assert restored.overlay({'articles':[{**A,'abstract':'An existing publisher abstract.'}]})['articles'][0]['abstract']=='An existing publisher abstract.'
    assert restored.cached({**A,'doi':'10.1000/new'}) is None
    assert len(calls)==1


def test_missing_index_still_allows_publisher_lookup_and_failures_are_cached(tmp_path):
    calls=[]
    def getter(url):
        calls.append(url)
        if '/works?' in url:return '{"results":[]}',url
        if 'api.openalex' in url:return json.dumps({**work(),'abstract_inverted_index':None}),url
        if 'api.crossref' in url:return '{"message":{}}',url
        return '<meta name="citation_doi" content="10.1000/study"><div class="abstract">'+TEXT+'</div>', 'https://onlinelibrary.wiley.com/doi/10.1000/study'
    service=AbstractService(tmp_path,getter)
    assert service.batch({'articles':[A]})['found']==0
    assert service.lookup(A)['source']=='出版商网页'
    count=len(calls);assert service.lookup(A)['cached'] and len(calls)==count
    missing={**A,'id':'b'*64,'doi':'10.1000/missing'}
    assert service.lookup(missing)['status']=='unavailable'
    count=len(calls);assert service.lookup(missing)['cached'] and len(calls)==count


def test_public_fetch_rejects_untrusted_destinations_and_redirects(monkeypatch):
    for url in ('http://doi.org/10.1000/x','https://127.0.0.1/','https://api.openalex.org.evil.test/',
                'https://user:password@doi.org/x','https://doi.org:8766/x','https://evil.test/'):
        assert not allowed_url(url)
    class Redirect:
        status_code=302;headers={'Location':'https://127.0.0.1/admin'}
        def __enter__(self):return self
        def __exit__(self,*args):pass
    calls=[]
    def get(url,**kwargs):calls.append(url);return Redirect()
    monkeypatch.setattr('abstracts.requests.get',get)
    with pytest.raises(ValueError,match='支持范围'):fetch(A['link'])
    assert calls==[A['link']]
