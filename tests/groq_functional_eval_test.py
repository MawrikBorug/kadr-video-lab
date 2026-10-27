import importlib.util
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('functional_eval',ROOT/'scripts/groq-functional-eval.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
KEY='unit_fake_secret_value_123456789'
class Response:
    status=200
    def __init__(self,content=None,status=200,finish='stop',model=m.TEXT_MODEL):
        self.status=status
        self.body=json.dumps({'model':model,'choices':[{'finish_reason':finish,'message':{'content':json.dumps(content or {'ok':True})}}],'usage':{'total_tokens':12,'bad':KEY}}).encode()
    def read(self,n):return self.body[:n]
    def getheader(self,name):return None
class Transport:
    def __init__(self,response=None):self.response=response or Response();self.calls=[]
    def __call__(self,host,**kw):self.host=host;self.kw=kw;return self
    def request(self,*args,**kw):self.calls.append((args,kw))
    def getresponse(self):return self.response
    def close(self):pass
class Clock:
    def __init__(self):self.t=0
    def __call__(self):return self.t
    def sleep(self,n):self.t+=n
class Tests(unittest.TestCase):
    def client(self,t=None):
        c=Clock();return m.Client(KEY,transport=t or Transport(),clock=c,sleeper=c.sleep)
    def test_fixed_route_no_query_and_header_only_key(self):
        t=Transport();c=self.client(t);c.call('test',128)
        self.assertEqual(t.host,'api.groq.com');self.assertEqual(t.calls[0][0],('POST',m.ENDPOINT))
        self.assertNotIn(KEY,t.calls[0][1]['body'].decode());self.assertEqual(t.calls[0][1]['headers']['Authorization'],'Bearer '+KEY)
        self.assertNotIn(KEY,json.dumps(c.evidence))
    def test_missing_key_zero_attempts(self):
        c=self.client();c.secret=None
        with self.assertRaises(m.Stop):c.call('x')
        self.assertEqual(c.requests,0)
    def test_invalid_key_zero_attempts(self):
        c=self.client();c.secret='bad\nvalue'
        with self.assertRaises(m.Stop):c.call('x')
        self.assertEqual(c.requests,0)
    def test_redirect_no_retry(self):
        t=Transport(Response(status=302));c=self.client(t)
        with self.assertRaises(m.Stop):c.call('x')
        self.assertEqual(len(t.calls),1)
    def test_429_stops(self):
        t=Transport(Response(status=429));c=self.client(t)
        with self.assertRaisesRegex(m.Stop,''):c.call('x')
        self.assertEqual(c.requests,1)
    def test_window_budget_zero_calls(self):
        c=self.client()
        with self.assertRaises(m.Stop):c.call('x'*8000)
        self.assertEqual(c.requests,0)
    def test_max_requests(self):
        c=self.client()
        for i in range(6):c.call('x',128)
        with self.assertRaises(m.Stop):c.call('x',128)
        self.assertEqual(c.requests,6)
    def test_total_reservation(self):
        c=self.client();c.reserved=m.MAX_RESERVED-1
        with self.assertRaises(m.Stop):c.call('x')
        self.assertEqual(c.requests,0)
    def test_spacing(self):
        c=self.client();c.call('x',128);c.call('x',128)
        self.assertGreaterEqual(c.clock(),65)
    def test_timeout_unknown_once(self):
        class T(Transport):
            def getresponse(self):raise TimeoutError(KEY)
        t=T();c=self.client(t)
        try:c.call('x')
        except m.Stop as e:self.assertEqual(e.code,'OUTCOME_UNKNOWN_TIMEOUT')
        self.assertEqual(c.requests,1)
    def test_truncated_response_not_success(self):
        c=self.client(Transport(Response(finish='length')))
        with self.assertRaises(m.Stop):c.call('x')
    def test_wrong_model(self):
        c=self.client(Transport(Response(model='untrusted')))
        with self.assertRaises(m.Stop):c.call('x')
    def test_provider_secret_not_exported(self):
        c=self.client(Transport(Response({'text':KEY})))
        with self.assertRaises(m.Stop):c.call('x')
    def test_oversized_response(self):
        r=Response();r.body=b'x'*(m.MAX_RESPONSE+1)
        with self.assertRaises(m.Stop):self.client(Transport(r)).call('x')
    def test_gates(self):
        self.assertFalse(m.access_gate({'season':None},{'watched':False}))
        s={'season':1,'main_episode_ids':['1','2'],'composition_revision':2}
        state={'final_confirmed':True,'watched_episode_ids':['1','2'],'composition_revision':2}
        self.assertTrue(m.access_gate(s,state))
        for state2 in [dict(state,final_confirmed=False),dict(state,watched_episode_ids=['1']),dict(state,composition_revision=1)]:self.assertFalse(m.access_gate(s,state2))
    def test_future_claims_removed(self):
        p={'scope':{'id':'s1'},'claims':[{'id':'c1','text':'ok','kind':'fact','source_ids':['a'],'scope':'s1'},{'id':'future','text':'secret','source_ids':['b'],'scope':'s2'}]}
        self.assertEqual([c['id']for c in m.claim_projection(p)],['c1'])
    def test_invented_id_rejected(self):
        out={'sections':[{'id':'summary','paragraphs':[{'kind':'fact','text':'test','claim_ids':['invented']}],'insufficient_evidence':False}]}
        with self.assertRaises(m.Stop):m.validate_sections(out,['summary'],[])
    def test_missing_sections_rejected(self):
        with self.assertRaises(m.Stop):m.validate_sections({'sections':[]},['summary'],[])
    def test_review_cannot_accept_unknown_claim(self):
        with self.assertRaises(m.Stop):m.validate_review({'verdict':'pass','issues':[],'accepted_claim_ids':['unknown']},[])
    def test_urls_and_script_not_saved(self):
        self.assertFalse(m.safe_text('<script>evil'))
        self.assertFalse(m.safe_text('https://evil.example'))
    def test_blocked_vision_zero_calls(self):
        c=self.client()
        with self.assertRaises(m.Stop):m.vision(c,{'ready':False},1)
        self.assertEqual(c.requests,0)
    def test_image_count_and_budget(self):
        c=self.client()
        with self.assertRaises(m.Stop):c.call('test',512,images=[b'x']*4)
        self.assertEqual(c.requests,0)
    def test_never_product_publish(self):
        p={'scope':{'id':'film','season':None},'eligible_state':{'watched':True},'claims':[{'id':'c','text':'fact','source_ids':['s'],'scope':'film','sections':list(m.SECTIONS)}]}
        class Fake:
            def __init__(self):self.n=0
            def call(self,prompt,output):
                self.n+=1
                if self.n%2==0:return {'verdict':'pass','issues':[],'accepted_claim_ids':['c']}
                return {'sections':[{'id':i,'paragraphs':[{'kind':'interpretation','text':'Generated diagnostic text.','claim_ids':['c']}],'insufficient_evidence':False}for i in m.SECTIONS[((self.n-1)//2)*3:((self.n-1)//2+1)*3]]}
        out=m.analysis(Fake(),p)
        self.assertEqual(len(out['sections']),9);self.assertTrue(out['automatic_gate_candidate'])
        self.assertFalse(out['actual_product_publication']);self.assertFalse(out['accepted_quality'])
        self.assertEqual(out['independent_agent_review'],'PENDING')
    def test_real_source_packs_pair_preflight(self):
        class Reached(Exception):pass
        class Fake:
            def call(self,prompt,output):raise Reached()
        for filename in ('analysis-film.json','analysis-season.json'):
            with self.assertRaises(Reached):m.analysis(Fake(),m.read_fixture(filename))
    def test_evidence_gap_never_eligible(self):
        pack={'scope':{'id':'film','season':None},'eligible_state':{'watched':True},'claims':[{'id':'c','text':'fact','source_ids':['s'],'scope':'film','sections':list(m.SECTIONS)}]}
        class Fake:
            def __init__(self):self.n=0
            def call(self,prompt,output):
                self.n+=1
                if self.n%2==0:return {'verdict':'pass','issues':[],'accepted_claim_ids':[]}
                return {'sections':[{'id':i,'paragraphs':[{'kind':'evidence_gap','text':'Evidence is insufficient.','claim_ids':[]}],'insufficient_evidence':False}for i in m.SECTIONS[((self.n-1)//2)*3:((self.n-1)//2+1)*3]]}
        self.assertFalse(m.analysis(Fake(),pack)['automatic_gate_candidate'])
    def test_three_frame_pair_preflight_fits(self):
        # Realistic short candidate identity is budgeted before identify.
        prompt=m.dump({'task':'Compare candidates to all pixels independently. A real title is not frame proof. Reject conflicts.','candidates':[{'id':'sintel-2010','titles':['Sintel'],'year':2010,'format':'film'}],'shape':{'status':'matched|ambiguous|unknown','work_id':'candidate id or empty','reason':'observed consistency/conflicts'}})
        self.assertLessEqual(len((m.VISION_SYSTEM+prompt).encode())+512+512+6144,m.MAX_WINDOW)
    def test_long_russian_candidate_stops_without_trim(self):
        pack=m.read_fixture('analysis-film.json')
        class Fake:
            def __init__(self):self.n=0
            def call(self,prompt,output):
                self.n+=1
                return {'sections':[{'id':i,'paragraphs':[{'kind':'interpretation','text':'Обоснованная интерпретация. '*50,'claim_ids':['SI01']}],'insufficient_evidence':False}for i in m.SECTIONS[:3]]}
        client=Fake()
        with self.assertRaises(m.Stop)as cm:m.analysis(client,pack)
        self.assertEqual(cm.exception.code,'CANDIDATE_EXCEEDS_REVIEW_ENVELOPE_NO_TRUNCATION')
        self.assertEqual(client.n,1)
if __name__=='__main__':unittest.main()
