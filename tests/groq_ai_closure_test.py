import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('closure',ROOT/'scripts/groq-ai-closure.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_licensed_media_integrity_distinct_unknown(self):
  media=m.load_media();self.assertEqual(len(media),4)
  self.assertEqual(len({a['sha256']for a,_ in media[:3]}),3)
  self.assertTrue(all(max(a['dimensions'])<=1024 for a,_ in media));self.assertEqual(media[3][0]['license'],'CC0-1.0')
 def test_quotes_and_excerpts_never_exported(self):
  x=m.clean({'excerpt':'protected input','nested':{'quote':'exact support','start':10,'end':25},'key':'gsk_12345','secret':'unitkey'},'unitkey')
  self.assertNotIn('protected',json.dumps(x));self.assertNotIn('quote',json.dumps(x));self.assertNotIn('gsk_',json.dumps(x));self.assertNotIn('unitkey',json.dumps(x));self.assertEqual(x['nested']['start'],10)
 def test_exact_quote_grounding_and_scope(self):
  acquired={'scope':{'id':'test-film','title':'Film','year':2010,'season':None},'documents':[{'id':'S1','url':'https://public.example/source','title':'Source','rights':'CC','excerpt':'The heroine saves a young dragon.','sha256':'abc','checked_at':'date'}],'finality':{'state':'confirmed'}}
  class C:
   def call(self,*a,**kw):return {'claims':[{'id':'C1','text':'A heroine saves a dragon.','source_ids':['S1'],'sections':['summary'],'evidence_spans':[{'source_id':'S1','quote':'saves a young dragon'}]}],'coverage_gaps':[]}
  p=m.extract_source_pack(C(),acquired);self.assertEqual(p['claims'][0]['scope'],'test-film');self.assertEqual(p['claims'][0]['evidence_spans'][0]['start'],12)
  acquired['documents'][0]['excerpt']='Unrelated current text.'
  with self.assertRaises(m.m.Stop)as cm:m.extract_source_pack(C(),acquired)
  self.assertEqual(cm.exception.code,'SOURCE_QUOTE_NOT_IN_RETRIEVED_TEXT')
 def test_finality_unknown_never_calls_model(self):
  class C:
   def call(self,*a,**k):raise AssertionError('model must not run')
  with self.assertRaises(m.m.Stop)as cm:m.extract_source_pack(C(),{'scope':{'id':'s','season':1},'documents':[{'id':'S1'}],'finality':{'state':'unknown'}})
  self.assertEqual(cm.exception.code,'SEASON_FINALITY_UNKNOWN')
 def test_same_content_rejection_does_not_retry_or_block_other_cases(self):
  previous=m.CASE_ORDER;m.CASE_ORDER=('vision-one','vision-three','vision-unknown')
  old=m.vision_case
  calls=[]
  def case(client,name,media):
   calls.append(name)
   if name=='vision-one':raise m.m.Stop('VISION_SCHEMA')
   return {'diagnostic_assertion_pass':False}
  m.vision_case=case
  class C:
   def __init__(self,secret,checkpoint):self.secret=secret;self.requests=0;self.reserved=0;self.evidence=[];self.generated=[]
  old_report=m.REPORT
  try:
   with tempfile.TemporaryDirectory()as t:
    m.REPORT=Path(t)/'report.json';r=m.run(None,lambda k:None,[],client_factory=C)
    self.assertEqual(calls,list(m.CASE_ORDER));self.assertEqual(r['classification'],'COMPLETED_PENDING_INDEPENDENT_REVIEW');self.assertFalse(r['accepted_quality'])
  finally:m.CASE_ORDER=previous;m.vision_case=old;m.REPORT=old_report
 def test_transport_unknown_stops_all_without_retry(self):
  previous=m.CASE_ORDER;old=m.vision_case;old_report=m.REPORT;m.CASE_ORDER=('vision-one','vision-three')
  calls=[]
  def case(client,name,media):calls.append(name);raise m.m.Stop('OUTCOME_UNKNOWN_TIMEOUT')
  m.vision_case=case
  class C:
   def __init__(self,secret,checkpoint):self.secret=secret;self.requests=1;self.reserved=100;self.evidence=[];self.generated=[]
  try:
   with tempfile.TemporaryDirectory()as t:
    m.REPORT=Path(t)/'report.json';r=m.run(None,lambda k:None,[],client_factory=C)
    self.assertEqual(calls,['vision-one']);self.assertEqual(r['classification'],'STOPPED_OUTCOME_UNKNOWN_TIMEOUT');self.assertEqual(r['reserved_tokens'],100)
  finally:m.CASE_ORDER=previous;m.vision_case=old;m.REPORT=old_report
 def test_total_reservation_and_timeout_contract(self):
  self.assertEqual(m.m.MAX_REQUESTS,24);self.assertEqual(m.m.MAX_RESERVED,172000)
  self.assertLessEqual(20*m.m.MAX_WINDOW+4*m.DESCRIPTION_REQUEST_CAP,m.m.MAX_RESERVED)
  workflow=(ROOT/'.github/workflows/groq-ai-closure.yml').read_text();self.assertIn('timeout-minutes: 45',workflow);self.assertIn('github.run_attempt == 1',workflow)
 def test_source_extraction_not_a_stored_claims_fallback(self):
  class C:
   def call(self,*a,**k):raise AssertionError('no calls allowed')
  with self.assertRaises(m.m.Stop)as cm:m.extract_source_pack(C(),{'documents':[]})
  self.assertEqual(cm.exception.code,'SOURCE_ACQUISITION_UNAVAILABLE')
 def test_complete_suite_has_twentyfour_distinct_calls_no_recommendations(self):
  class C:
   def __init__(self,secret,checkpoint):self.secret=secret;self.requests=0;self.reserved=0;self.evidence=[];self.generated=[];self.checkpoint=checkpoint
   def call(self,prompt,output=2200,images=()):
    self.requests+=1;self.reserved+=1000;data=json.loads(prompt);task=data['task']
    if task.startswith('Identify')and'description'in data:
     value={'hypotheses':[{'title':'Dune','year':2021,'format':'film','description_evidence':'actor and year'}],'unknown':False}
    elif task.startswith('Verify candidates'):
     value={'status':'matched','work_id':'tmdb:movie:438631','reason':'matching actor and year'}
    elif task.startswith('Identify'):
     value={'hypotheses':[{'title':'Sintel','year':2010,'format':'film','observed_features':'drawn dragon'}],'unknown':False}
    elif task.startswith('Compare'):
     value={'status':'matched','work_id':'sintel-2010','reason':'test pixels'}
    elif task.startswith('Extract'):
     value={'claims':[{'id':'C1','text':'The heroine saves a dragon.','source_ids':['D1'],'sections':list(m.m.SECTIONS),'evidence_spans':[{'source_id':'D1','quote':'heroine saves a dragon'}]}],'coverage_gaps':[]}
    elif task.startswith('Write'):
     value={'sections':[{'id':section,'paragraphs':[{'kind':'interpretation','text':'Diagnostic interpretation based on the supported event.','claim_ids':['C1']}],'insufficient_evidence':False}for section in data['requested_sections']]}
    else:value={'verdict':'pass','issues':[],'accepted_claim_ids':['C1']}
    self.evidence.append({'model':'fake','status':200,'usage':{}});self.generated.append({'operation':self.requests,'content':m.clean(value)});self.checkpoint();return value
  def acquire(kind):
   scope={'id':kind,'title':'Diagnostic fixture','year':2010,'season':None}
   if kind=='season':scope.update(season=1,composition_revision=1,main_episode_ids=['e1'])
   return {'scope':scope,'documents':[{'id':'D1','title':'Source','url':'https://public.example/source','rights':'test only','excerpt':'The heroine saves a dragon.','sha256':'test'}],'finality':{'state':'confirmed'}}
  old=m.REPORT
  try:
   with tempfile.TemporaryDirectory()as directory:
    m.REPORT=Path(directory)/'report.json';r=m.run('fake',acquire,m.load_media(),client_factory=C)
    self.assertEqual(r['attempted_requests'],24);self.assertEqual(len(r['cases']),7)
    self.assertEqual(len(r['cases'][5]['result']['sections']),9);self.assertEqual(len(r['cases'][6]['result']['sections']),9)
    self.assertFalse(r['recs_repeated']);self.assertFalse(r['accepted_quality']);self.assertFalse(r['actual_product_publication'])
    # Unknown fixture was deliberately misidentified; record failure, not a suite PASS.
    self.assertFalse(r['cases'][4]['result']['diagnostic_assertion_pass'])
  finally:m.REPORT=old
 def test_unvalidated_extraction_dict_never_enters_artifact_buffer(self):
  old=m.m.Client.call
  malicious={'claims':[],'coverage_gaps':[],'unexpected_copied_source':'PROTECTED_SOURCE_SENTINEL'}
  m.m.Client.call=lambda *a,**k:malicious
  snapshots=[]
  client=m.EvidenceClient('fake-key',checkpoint=lambda:snapshots.append(list(client.generated)))
  acquired={'scope':{'id':'film','title':'Sintel','season':None},'documents':[{'id':'S1','excerpt':'The heroine saves a young dragon.'}],'finality':{'state':'confirmed'}}
  try:
   with self.assertRaises(m.m.Stop)as cm:m.extract_source_pack(client,acquired)
   self.assertEqual(cm.exception.code,'SOURCE_EXTRACTION_SCHEMA')
   self.assertEqual(client.generated,[])
   self.assertNotIn('PROTECTED_SOURCE_SENTINEL',json.dumps(snapshots))
  finally:m.m.Client.call=old
 def test_description_only_known_resolves_typed_id_without_images(self):
  class C:
   def __init__(self):self.calls=[]
   def call(self,prompt,output=0,images=()):
    self.calls.append((prompt,output,images))
    self_outer.assertEqual(images,())
    self_outer.assertLessEqual(len((m.m.SYSTEM+prompt).encode())+512+output,3000)
    if len(self.calls)==1:return {'hypotheses':[{'title':'Dune','year':2021,'format':'film','description_evidence':'actor/year'}],'unknown':False}
    return {'status':'matched','work_id':'tmdb:movie:438631','reason':'matching actor/year'}
  self_outer=self;c=C();r=m.description_case(c,'description-known')
  self.assertTrue(r['diagnostic_assertion_pass']);self.assertEqual(len(c.calls),2);self.assertTrue(r['no_images'])
  self.assertEqual(r['identity_candidates'][0]['external_ids'][0],{'namespace':'tmdb','entity_type':'movie','value':'438631'})
  self.assertIn('NOT_LIVE',r['identity_route'])
 def test_description_unknown_false_certainty_is_recorded_not_passed(self):
  class C:
   def __init__(self):self.n=0
   def call(self,*a,**k):
    self.n+=1
    return {'hypotheses':[{'title':'Dune','year':2021,'format':'film','description_evidence':'unsupported guess'}],'unknown':False}if self.n==1 else {'status':'matched','work_id':'tmdb:movie:438631','reason':'unsupported guess'}
  r=m.description_case(C(),'description-unknown');self.assertFalse(r['diagnostic_assertion_pass']);self.assertTrue(r['false_certainty_in_unknown_case'])
 def test_description_unknown_abstains_without_invented_id(self):
  class C:
   def __init__(self):self.n=0
   def call(self,*a,**k):
    self.n+=1
    return {'hypotheses':[],'unknown':True}if self.n==1 else {'status':'unknown','work_id':'','reason':'no confirmed candidate'}
  r=m.description_case(C(),'description-unknown');self.assertTrue(r['diagnostic_assertion_pass']);self.assertEqual(r['identity_candidates'],[])
 def test_description_cannot_match_unverified_provider_id(self):
  class C:
   def __init__(self):self.n=0
   def call(self,*a,**k):
    self.n+=1
    return {'hypotheses':[],'unknown':True}if self.n==1 else {'status':'matched','work_id':'tmdb:movie:999999','reason':'invented identity'}
  with self.assertRaises(m.m.Stop)as cm:m.description_case(C(),'description-known')
  self.assertEqual(cm.exception.code,'DESCRIPTION_UNVERIFIED_ID')
 def test_typed_identity_does_not_confuse_tmdb_movie_and_tv(self):
  identities=[{'id':'movie:7','titles':['Name'],'year':2020,'format':'film','external_ids':[{'namespace':'tmdb','entity_type':'movie','value':'7'}]},{'id':'tv:7','titles':['Name'],'year':2020,'format':'series','external_ids':[{'namespace':'tmdb','entity_type':'tv','value':'7'}]}]
  found=m.resolve_description_identities([{'title':'Name','year':2020,'format':'series'}],identities)
  self.assertEqual([x['id']for x in found],['tv:7'])
if __name__=='__main__':unittest.main()
