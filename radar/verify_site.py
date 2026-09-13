import json, os
from pathlib import Path
from collections import Counter

root=Path(__file__).resolve().parents[1]
site=root/'site'
data=json.loads((site/'data.json').read_text(encoding='utf-8'))
journals=data['journals'];articles=data['articles'];ids={j['id'] for j in journals}
registry=json.loads((root/'radar/journals.json').read_text(encoding='utf-8'))
expected={j['id'] for j in registry['journals'] if j.get('enabled',True)}
assert ids==expected and len(journals)==len(ids),'Missing or duplicate journals'
assert len({a['id'] for a in articles})==len(articles),'Duplicate article ids'
dois=[a['doi'] for a in articles if a['doi']]
assert len(set(dois))==len(dois),'Duplicate DOIs'
assert all(a['journal_id'] in ids and a['title'] and a['link'].startswith(('http://','https://')) for a in articles)
for name in ['index.html','app.js','style.css','enhancements.css','translation.js','catalog.js','sw.js','manifest.webmanifest','icon-192.png','icon-512.png']:
    assert (site/name).is_file(),name
catalog=json.JSONDecoder().raw_decode((site/'catalog.js').read_text(encoding='utf-8').split('const JOURNAL_CATALOG = ',1)[1])[0]
assert set(catalog)==ids,'Missing catalog metadata'
for journal_id,entry in catalog.items():
    assert journal_id in ids,'Unknown catalog journal'
    cover=entry['cover']
    if cover:assert Path(cover).name==cover and (site/cover).is_file(),'Missing catalog cover'
assert len(articles)>0,'No real articles collected'
statuses=Counter(j['status'] for j in journals)
enriched=sum(bool(a.get('abstract_source')) for a in articles)
assert all(a.get('abstract') and a.get('abstract_url','').startswith('https://') for a in articles if a.get('abstract_source')),'Invalid abstract provenance'
message=f"Journal Radar: {len(journals)} journals, {len(articles)} articles; {enriched} enriched abstracts; status={dict(statuses)}"
print(message)
if os.getenv('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a',encoding='utf-8') as stream:
        stream.write('## Journal Radar\n\n'+message+'\n\n| Journal | Status | Articles |\n|---|---|---|\n')
        for j in journals:stream.write(f"| {j['name']} | {j['status']} | {j['article_count']} |\n")
