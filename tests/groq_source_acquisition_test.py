import importlib.util
import json
from pathlib import Path
import unittest
SPEC=importlib.util.spec_from_file_location('sources',Path(__file__).resolve().parents[1]/'scripts/groq-source-acquisition.py')
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
class Response:
 status=200
 def __init__(self,text,status=200):self.body=text.encode();self.status=status
 def read(self,size):return self.body[:size]
 def getheader(self,key):return 'text/html; charset=utf-8' if key.lower()=='content-type'else None
class Factory:
 def __init__(self,documents):self.documents=documents;self.calls=[]
 def __call__(self,host,**kwargs):self.host=host;return self
 def request(self,method,path,headers):self.calls.append((method,self.host,path));self.path=path
 def getresponse(self):return self.documents.get(self.host,Response('<html></html>',404))
 def close(self):pass
AMAZON='<h1>Fallout cast and creators</h1><p>All eight episodes of Fallout Season 1 are available to watch.</p><p>In the final episode of Fallout Season 1, the story concludes.</p>'
PRIME='<title>Prime Video: Fallout – Staffel 1</title>'+''.join('<h3>'+str(i)+'. Example '+str(i)+'</h3>'for i in range(1,9))
class Tests(unittest.TestCase):
 def test_scope_and_official_finality(self):
  f=Factory({'www.aboutamazon.com':Response(AMAZON),'www.primevideo.com':Response(PRIME)})
  result=m.acquire('season',f)
  self.assertEqual(result['finality']['state'],'confirmed');self.assertEqual(len(result['scope']['main_episode_ids']),8)
  self.assertNotIn('excerpt',m.public_metadata(result['documents'][0]));self.assertIn('sha256',result['documents'][0])
 def test_episode_count_alone_not_final(self):
  f=Factory({'www.aboutamazon.com':Response('<h1>Fallout</h1><p>Eight episodes are planned.</p>'),'www.primevideo.com':Response(PRIME)})
  self.assertEqual(m.acquire('season',f)['finality']['state'],'unknown')
 def test_final_mention_alone_not_final(self):
  f=Factory({'www.aboutamazon.com':Response(AMAZON),'www.primevideo.com':Response('<title>Fallout Staffel 2</title>'+PRIME.split('</title>')[1])})
  self.assertEqual(m.acquire('season',f)['finality']['state'],'unknown')
 def test_redirect_no_retry_no_cached_fallback(self):
  f=Factory({'en.wikipedia.org':Response('',302)})
  result=m.acquire('film',f)
  self.assertEqual(result['documents'],[]);self.assertEqual(len(f.calls),2)
  self.assertIn({'source_id':'S1','code':'HTTP_302'},result['failures'])
 def test_unknown_url_no_call(self):
  f=Factory({})
  with self.assertRaises(m.SourceError):m._fetch('https://attacker.example/',f)
  self.assertEqual(f.calls,[])
 def test_gamesradar_future_filtered_not_promoted_stop(self):
  html='<h1>Fallout season 1 ending explained</h1><p>Lucy meets Hank in a room.</p><h3>Fallout season 3 promoted article</h3><p>Season 2 reveals FUTURE_SECRET.</p><p>Lucy shoots a target in this synthetic parser case.</p>'
  excerpt,_,_=m._extract(html,'gamesradar')
  self.assertNotIn('FUTURE_SECRET',excerpt);self.assertIn('Lucy shoots',excerpt)
 def test_sintel_full_plot_selected_before_navigation(self):
  html='<title>Sintel</title><p>Sintel is a film.</p><h2>Plot</h2><p>Sintel meets Scales.<br> A dragon waits.</p><h2>References</h2><p>Unrelated film navigation should not enter input.</p>'
  excerpt,_,_=m._extract(html,'sintel')
  self.assertIn('A dragon waits',excerpt);self.assertNotIn('navigation',excerpt)
 def test_copyright_word_bound(self):
  text=' '.join('word'+str(i)+'.'for i in range(1000))
  self.assertLessEqual(len(m._bound([text],200).split()),200)
 def test_no_raw_exception_export(self):
  class Bad:
   def __call__(self,*a,**kw):raise RuntimeError('PRIVATE_STRING')
  result=m.acquire('film',Bad())
  self.assertNotIn('PRIVATE_STRING',json.dumps(result));self.assertEqual(result['documents'],[])
 def test_wrong_work_rejected(self):
  with self.assertRaises(m.SourceError):m._extract('<title>Another film</title><p>Sintel appears in a navigation link.</p>','sintel')
 def test_void_tag_does_not_swallow_following_paragraphs(self):
  parser=m.Blocks();parser.feed('<p>text<br>more<img src="x"></p><p>next</p>')
  self.assertEqual(parser.rows,[('p','text more'),('p','next')])
 def test_actual_amazon_rich_text_structure(self):
  html='<h1>Fallout cast and creators</h1><div class="contentItem-role-text"><span class="text v2"><div class="text"><a><span>watch all eight episodes of </span><span><span>Fallout </span></span><span>Season 1</span></a></div></span></div><div class="contentItem-role-text"><span>In the final episode of </span><span><span>Fallout</span></span><span> Season 1, Lucy learns the truth.</span></div>'
  _,proof,_=m._extract(html,'amazon')
  self.assertTrue(proof['all_eight_available']);self.assertTrue(proof['final_episode_mentioned'])
 def test_known_large_article_bound_is_still_finite(self):
  self.assertEqual(m.MAX_BODY,4000000)
  self.assertLessEqual(m.MAX_BODY,4*1024*1024)
if __name__=='__main__':unittest.main()
