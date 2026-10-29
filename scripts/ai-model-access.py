import http.client,json,os,ssl
from pathlib import Path

c=http.client.HTTPSConnection('api.groq.com',timeout=30,context=ssl.create_default_context())
c.request('GET','/openai/v1/models',headers={'Authorization':'Bearer '+os.environ['GROQ_API_KEY']})
r=c.getresponse()
result={'http_status':r.status,'inference_requests':0}
if r.status==200:
 d=json.loads(r.read(200000))
 result['models']=[{k:v for k,v in m.items() if k in ('id','active','owned_by','context_window','max_completion_tokens')} for m in d.get('data',[])]
c.close()
p=Path('artifacts/ai-access/report.json');p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(result,indent=2))
print(json.dumps(result))
