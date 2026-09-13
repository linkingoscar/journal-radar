import json, os
from pathlib import Path
from collections import Counter

root=Path(__file__).resolve().parents[1]
site=root/'site'
data=json.loads((site/'data.json').read_text(encoding='utf-8'))
journals=data['journals'];articles=data['articles'];ids={j['id'] for j in journals}
assert len(journals)==55 and len(ids)==55
assert len({a['id'] for a in articles})==len(articles),'Duplicate article ids'
dois=[a['doi'] for a in articles if a['doi']]
assert len(set(dois))==len(dois),'Duplicate DOIs'
assert all(a['journal_id'] in ids and a['title'] and a['link'].startswith(('http://','https://')) for a in articles)
for name in ['index.html','app.js','style.css','sw.js','manifest.webmanifest','icon-192.png','icon-512.png']:
    assert (site/name).is_file(),name
assert len(articles)>0,'No real articles collected'
statuses=Counter(j['status'] for j in journals)
message=f"Journal Radar: {len(journals)} journals, {len(articles)} articles; status={dict(statuses)}"
print(message)
if os.getenv('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a',encoding='utf-8') as stream:
        stream.write('## Journal Radar\n\n'+message+'\n\n| Journal | Status | Articles |\n|---|---|---|\n')
        for j in journals:stream.write(f"| {j['name']} | {j['status']} | {j['article_count']} |\n")
