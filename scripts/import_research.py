"""Rebuild the public, non-secret working registry from S04 after checking S02."""
import collections, hashlib, json, pathlib, sys

source, providers_sheet, identity_sheet = map(pathlib.Path, sys.argv[1:4])
d = json.loads(source.read_text())
sheet = json.loads(providers_sheet.read_text())['values']
identity = json.loads(identity_sheet.read_text())['values'][1:]
expected = {f'C{i:02}' for i in range(1,36)} | {f'X{i:02}' for i in range(1,33)} | {f'L{i:03}' for i in range(1,59)}
assert len(d['providers']) == 125 and {p['id'] for p in d['providers']} == expected
rows = {r[0]:r for r in sheet[1:]}
assert set(rows) == expected
for p in d['providers']:
    assert [p['name'],p['role'],p['status']] == [rows[p['id']][1],rows[p['id']][2],rows[p['id']][3]], p['id']
    assert p['reason'] == rows[p['id']][6] and p['next'] == rows[p['id']][7], p['id']
assert len(d['adapters']) == 70 and len(d['evidence']) == 444 and len(d['coverage']) == 1750
assert len({(r['provider'],r['title_id']) for r in d['coverage']}) == 1750
for s,r in zip(d['sample'],identity):
    assert s[0] == r[0] and str(s[2]) == r[3]
    assert (str(s[5]) if s[5] else 'Не установлен') == r[6]
keys = dict(C13='archive',C11='aniliberty',C28='vidapi',C29='vidlink',C30='vidzee',X21='stellar',X22='yapgrid',X23='mapple',X25='embedwave',X26='vidrift',X27='cinesrc',X28='mikai',X30='cinezo',X31='primesrc',X09='filmix',X18='vokino',L006='animeon',X24='ezvidapi')
registry = []
for p in d['providers']:
    item = {k:p[k] for k in ['id','name','role','historical','historical_axes','sources','new','status','reason','next','key','access']}
    item['providerKey'] = keys.get(p['id'],'ref-'+p['id'].lower())
    item['adapters'] = [a['name'] for a in p['adapters']]
    item['relatedIds'] = sorted({d['mapping'][a] for a in item['adapters'] if a in d['mapping']} - {p['id']})
    item['sharedUpstreams'] = []
    if p['id'] in ['X03']: item['sharedUpstreams'] = ['apbugall: Alloha / Aladin / Mirage / Phantom / Spectre']
    if p['id'] in ['X28','L006']: item['sharedUpstreams'] = ['X11 Ashdi','L010 MoonAnime','L043 Fenix','L040 Tortuga']
    if p['id'] == 'X31': item['sharedUpstreams'] = ['L050 Filemoon','L058 Voe','L048 Dood']
    if p['id'] == 'L037': item['sharedUpstreams'] = ['X07 VideoDB configuration; не тождественен X15 Zetflix']
    if p['id'] in ['C07','C08','C09','C26']:
        item['workingStatus'] = 'excluded' if p['id'] != 'C26' else 'out-of-scope'
    elif p['id'] in ['C12','C14','X32']:
        item['workingStatus'] = 'needs-test-object' if p['id'] != 'X32' else 'unknown-contract'
    else: item['workingStatus'] = 'per-mode' if p['id'] in keys else p['status']
    item['accessPreparation'] = {'secretObtained':False,'state':'key-not-needed' if p['id'] in ['C11','C13','C28','C29','C30','X21','X22','X23','X25','X26','X27','X30','X31','L006'] else 'optional' if p['id']=='X28' else 'free-conditions-unconfirmed' if p['id'] in ['X18','X02','X08','X03','X05','C25'] else 'unknown-or-not-applicable'}
    if p['id']=='X18': item['accessPreparation']['modes']={'catalog':'key-not-needed','online':'free-conditions-unconfirmed; own token and private server required'}
    if p['id']=='X09': item['accessPreparation']['modes']={'catalog':'key-not-needed','video-links':'blocked-or-conditions-unconfirmed'}
    registry.append(item)
oldkeys = {'T01':'master','T02':'hundred','T04':'dune','T05':'substance','T09':'boy','T10':'fallout','T12':'solo','T13':'frieren','T14':'dandadan'}
samples = []
for r in identity:
    s = dict(key=oldkeys.get(r[0],r[0].lower()), canonicalId=r[0],title=r[1],year=int(r[2]),kp=r[3],imdb=r[4] if r[4].startswith('tt') else None,type=r[5],tmdb=r[6] if str(r[6]).isdigit() else None,season=r[7],episode=r[8],episodeTitle=r[9],identityNote=r[10],source=r[11].split('\n')[0],category='anime' if r[0] in ['T12','T13','T14'] else 'series' if r[5]=='tv' else 'ru-film' if r[0] in ['T01','T02','T03','T07','T08'] else 'foreign-film')
    if r[0] in ['T12','T13','T14']:
        i=['T12','T13','T14'].index(r[0]);s.update(aniliberty=['9600','9542','9789'][i],mal=['52299','52991','57334'][i],animeon=['1283','924','3384'][i])
    if r[0] == 'T04': s['filmix']='170881'
    samples.append(s)
root=pathlib.Path(__file__).resolve().parents[1]
public=root/'web/data';public.mkdir(exist_ok=True)
for name,v in [('registry.json',registry),('samples.json',samples)]: (public/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
check={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'lampacCommit':d['sha'],'providerCount':len(registry),'idSets':'C01–C35, X01–X32, L001–L058','sheetProviderRowsMatched':125,'sheetIdentityRowsMatched':14,'adapters':70,'httpProbes':443,'browserAttempts':1,'coverageStates':1750,'researchStatuses':dict(collections.Counter(p['status'] for p in d['providers'])),'result':'PASS','scope':'source integrity, not playback'}
(root/'evidence/research-integrity.json').write_text(json.dumps(check,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(check,ensure_ascii=False))
