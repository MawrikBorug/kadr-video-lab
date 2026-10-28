#!/usr/bin/env python3
"""Narrow public-source acquisition. Excerpts are RAM-only; metadata is persistable."""
import datetime
import hashlib
import http.client
from html.parser import HTMLParser
import re
import ssl
import time
from urllib.parse import urlsplit

MAX_BODY = 4000000
SOURCES = {
 'film': [
  {'id':'S1','url':'https://en.wikipedia.org/wiki/Sintel','title':'Sintel — Wikipedia','rights':'CC-BY-SA; Wikipedia contributors; retain article/history attribution','tier':'secondary','parser':'sintel'},
  {'id':'S2','url':'https://studio.blender.org/characters/5d403c21ee3219164b952e20/v2/','title':'Scales adult dragon — Blender Studio','rights':'Public metadata only; no model/rig redistribution','tier':'primary','parser':'blender'},
 ],
 'season': [
  {'id':'F1','url':'https://www.aboutamazon.com/news/entertainment/fallout-tv-series-cast','title':'Fallout cast and creators — Amazon','rights':'Copyright Amazon; RAM-only bounded source input; no raw text in artifacts','tier':'primary','parser':'amazon'},
  {'id':'F2','url':'https://www.primevideo.com/-/de/detail/0HAQAA7JM43QWX0H6GUD3IOF70?tr=pr','title':'Fallout season 1 — Prime Video','rights':'Copyright Amazon; catalogue facts only; RAM-only text','tier':'primary','parser':'prime'},
  {'id':'F3','url':'https://www.gamesradar.com/fallout-season-1-ending-explained-hank-new-vegas/','title':'Fallout S1 ending explained — GamesRadar','rights':'Copyright Future; RAM-only bounded source input; no raw text in artifacts','tier':'secondary','parser':'gamesradar'},
 ]}
# Fixed routes only. Caller cannot supply a URL or append a query.
ROUTES = frozenset(row['url'] for rows in SOURCES.values() for row in rows)
class SourceError(Exception):
 def __init__(self, code): self.code=code

class Blocks(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True); self.rows=[]; self.active=None; self.depth=0; self.parts=[]; self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style','noscript','svg'): self.skip+=1
  if self.skip:return
  if tag in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'):return
  if self.active is not None:self.depth+=1
  elif tag in ('p','h1','h2','h3','h4','title') or (tag=='div' and 'contentItem-role-text' in dict(attrs).get('class','').split()):
   self.active=tag;self.depth=1;self.parts=[]
 def handle_endtag(self,tag):
  if tag in ('script','style','noscript','svg') and self.skip:self.skip-=1;return
  if self.skip:return
  if self.active is not None:
   self.depth-=1
   if self.depth<=0:
    value=re.sub(r'\s+',' ',' '.join(self.parts)).strip()
    if value:self.rows.append(('p' if self.active=='div' else self.active,value))
    self.active=None;self.parts=[];self.depth=0
 def handle_data(self,value):
  if self.active and not self.skip:self.parts.append(value)

FUTURE = re.compile(r'\b(?:season\s*[2-9]|second season|third season|staffel\s*[2-9])\b',re.I)

def _fetch(url, transport=None):
 if url not in ROUTES:raise SourceError('URL_NOT_ALLOWLISTED')
 parts=urlsplit(url); conn=None
 if parts.scheme!='https' or parts.username or parts.password or parts.port:raise SourceError('INVALID_SOURCE_ROUTE')
 try:
  conn=(transport or http.client.HTTPSConnection)(parts.hostname,timeout=20,context=ssl.create_default_context())
  path=parts.path+('?' + parts.query if parts.query else '')
  conn.request('GET',path,headers={'User-Agent':'KADR-Architecture-Evaluation/1.0 (https://github.com/MawrikBorug/kadr-video-lab)','Accept':'text/html','Accept-Encoding':'identity'})
  r=conn.getresponse()
  if r.status!=200:raise SourceError('HTTP_'+str(r.status) if type(r.status)is int and 100<=r.status<=599 else 'INVALID_HTTP_STATUS')
  raw=r.read(MAX_BODY+1)
  if len(raw)>MAX_BODY:raise SourceError('SOURCE_TOO_LARGE')
  content_type=r.getheader('Content-Type') or ''
  if 'text/html' not in content_type.lower():raise SourceError('SOURCE_NOT_HTML')
  html=raw.decode('utf8',errors='replace')
  return html,hashlib.sha256(raw).hexdigest()
 except SourceError:raise
 except Exception:raise SourceError('TRANSPORT_OR_DECODE_ERROR')
 finally:
  if conn is not None:
   try:conn.close()
   except Exception:pass

def _bound(rows, words=200):
 # Paragraph selection stops at a sentence/paragraph boundary; never writes whole pages.
 selected=[];used=0
 for row in rows:
  if FUTURE.search(row):continue
  for sentence in re.split(r'(?<=[.!?])\s+',row):
   count=len(sentence.split())
   if count==0:continue
   if used+count>words:continue
   selected.append(sentence);used+=count
 return '\n'.join(selected)

def _extract(html,kind):
 parser=Blocks();parser.feed(html);rows=parser.rows
 headings=[text for tag,text in rows if tag.startswith('h')]
 title=' '.join(text for tag,text in rows if tag=='title')
 paragraphs=[text for tag,text in rows if tag=='p']
 if kind=='sintel':
  if not re.search(r'\bSintel\b',title+' '+' '.join(headings[:2])):raise SourceError('WORK_IDENTITY_UNCONFIRMED')
  # The article concerns one standalone work. Reject navigation/references and
  # select overview/plot/production paragraphs by actual article headings.
  relevant=[];plot=[];section='intro'
  for tag,text in rows:
   if tag in ('h2','h3','h4'):section=text.lower()
   if tag=='p' and (section=='intro' or any(s in section for s in ('plot','overview','technical information'))):
    if any(w in text.lower()for w in ('sintel','scales','blender','dragon','film')):
     (plot if 'plot' in section else relevant).append(text)
  if not relevant and not plot:raise SourceError('NO_SCOPED_PARAGRAPHS')
  return _bound(plot+relevant,420),{'identity':'Sintel','scope':'standalone'},420
 if kind=='blender':
  selected=[p for p in paragraphs if ('scales' in p.lower()or 'sintel'in p.lower())]
  if not selected:raise SourceError('NO_SCOPED_METADATA')
  return _bound(selected,100),{'identity':'Sintel','scope':'standalone'},100
 if kind=='amazon':
  if not any('fallout'in h.lower()for h in headings[:3]):raise SourceError('WORK_IDENTITY_UNCONFIRMED')
  # Entire article is the original S1 creator panel; exclude future paragraphs.
  scoped=[];future_level=None
  for tag,text in rows:
   if re.fullmatch(r'h[1-4]',tag):
    level=int(tag[1])
    if FUTURE.search(text):future_level=level if future_level is None else min(level,future_level);continue
    if future_level is not None and level<=future_level:future_level=None
   if tag=='p'and future_level is None and not FUTURE.search(text):scoped.append(text)
  selected=[p for p in scoped if any(k in p.lower()for k in ('fallout','nolan','geneva','wagner','lucy','eight','final episode','finale','camera','visual'))]
  all_text=' '.join(selected)
  # Preserve finality signals from the entire scoped selection, then allocate the
  # existing200-word input budget to finality AND the explicit visual subsection.
  # Article order previously starved the latter behind unrelated cast paragraphs.
  available=bool(re.search(r'watch\s+all\s+eight\s+episodes\s+of\s+Fallout\s+Season\s+1|all\s+eight\s+episodes\s+of\s+Fallout\s+Season\s+1\s+are\s+(?:now\s+)?available',all_text,re.I))
  final=bool(re.search(r'final\s+episode\s+of\s+Fallout\s+Season\s+1',all_text,re.I))
  visual=[];inside_visual=False;visual_level=None;future_level=None
  for tag,text in rows:
   if re.fullmatch(r'h[1-4]',tag):
    level=int(tag[1])
    if FUTURE.search(text):future_level=level if future_level is None else min(level,future_level);inside_visual=False;continue
    if future_level is not None:
     if level>future_level:continue
     future_level=None
    if re.search(r'^Less was more visually$',text,re.I):inside_visual=True;visual_level=level;continue
    if inside_visual and level<=visual_level:inside_visual=False
   if tag=='p'and inside_visual and future_level is None and not FUTURE.search(text):visual.append(text)
  finality=[p for p in selected if re.search(r'final episode of Fallout Season 1|all eight episodes of Fallout Season 1',p,re.I)]
  # Bound each priority independently; a long finality paragraph cannot consume
  # the visual allocation. The last pass fills remaining words without duplicates.
  visual_sentences=[s for p in visual for s in re.split(r'(?<=[.!?])\s+',p)]
  visual_sentences.sort(key=lambda s:0 if re.search(r'photograph|visual effects|Nolan said',s,re.I)else 1)
  priority=_bound(finality,65).splitlines()+_bound(visual_sentences,125).splitlines()
  remainder=[s for p in selected for s in re.split(r'(?<=[.!?])\s+',p)if s not in priority]
  return _bound(priority+remainder,200),{'all_eight_available':available,'final_episode_mentioned':final,'identity':'Fallout','visual_subsection_present':bool(visual)},200
 if kind=='prime':
  selected_season=bool(re.search(r'Fallout.{0,40}(?:Staffel\s*1|Season\s*1)',title,re.I))
  numbers=set()
  labels=[]
  for heading in headings:
   found=re.match(r'^(?:S(?:taffel)?\s*1\s*[-–:]\s*)?(?:E(?:pisode)?\s*)?([1-8])[.\s–:-]+(.{1,90})$',heading,re.I)
   if found:numbers.add(int(found.group(1)));labels.append(found.group(0))
  # Explicit catalogue entries constitute publisher-asserted released availability,
  # not date<=now. Finality additionally requires the independent official panel.
  return _bound(labels,160),{'selected_season_one':selected_season,'episode_numbers':sorted(numbers)},160
 if kind=='gamesradar':
  if not any(re.search(r'Fallout season\s*1 ending',h,re.I)for h in headings[:4]):raise SourceError('SEASON_IDENTITY_UNCONFIRMED')
  selected=[];inside=False;future_level=None
  for tag,text in rows:
   if re.fullmatch(r'h[1-4]',tag):
    level=int(tag[1])
    if re.search(r'Fallout season\s*1 ending explained',text,re.I):inside=True
    if not inside:continue
    if FUTURE.search(text):
     # Exclude the entire future-heading subtree. Paragraphs without their own
     # season marker remain out of scope until a nonfuture sibling/ancestor.
     future_level=level if future_level is None else min(level,future_level)
     continue
    if future_level is not None:
     if level>future_level:continue
     future_level=None
    if tag=='h2' and re.search(r'^(?:latest|most popular|related|more about|comments)',text,re.I):break
   if tag=='p'and inside and future_level is None and not FUTURE.search(text)and any(w in text.lower()for w in ('hank','lucy','moldaver','maximus','ghoul','vault','rose','wilzig','fusion','vegas')):selected.append(text)
  if not selected:raise SourceError('NO_SCOPED_PARAGRAPHS')
  selected.sort(key=lambda p:0 if any(k in p.lower()for k in ('lucy shoots','maximus arrives','hank then destroyed','cold fusion device','rose','mother'))else 1)
  return _bound(selected,200),{'identity':'Fallout','season':1},200
 raise SourceError('UNKNOWN_PARSER')

def public_metadata(document):
 return {k:v for k,v in document.items()if k!='excerpt'}

def acquire(kind='film',transport=None):
 if kind not in SOURCES:raise SourceError('UNKNOWN_KIND')
 scope={'id':'sintel-2010','title':'Sintel','year':2010,'season':None}if kind=='film'else {'id':'fallout-s1','title':'Fallout','year':2024,'season':1,'composition_revision':1,'main_episode_ids':['fallout-s1:e'+str(i)for i in range(1,9)]}
 result={'scope':scope,'documents':[],'finality':{'state':'confirmed'if kind=='film'else'unknown','basis':'standalone work'if kind=='film'else'insufficient current official evidence'},'limitations':['Narrow allowlisted diagnostic source adapter; not a universal source-discovery service.','Excerpts remain RAM-only. Source failure never silently falls back to stored claims.'],'failures':[]}
 signals={}
 for source in SOURCES[kind]:
  try:
   html,sha=_fetch(source['url'],transport);excerpt,evidence,wordlimit=_extract(html,source['parser']);html=None
   if not excerpt:raise SourceError('EMPTY_SCOPED_EXCERPT')
   signals[source['id']]=evidence
   doc={k:v for k,v in source.items()if k!='parser'}
   doc.update(excerpt=excerpt,sha256=sha,checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),scope_id=scope['id'],scope_evidence=evidence,maximum_input_words=wordlimit)
   result['documents'].append(doc)
  except SourceError as exc:result['failures'].append({'source_id':source['id'],'code':exc.code})
 if kind=='season':
  primary=signals.get('F1',{});catalogue=signals.get('F2',{})
  if primary.get('all_eight_available')and primary.get('final_episode_mentioned')and catalogue.get('selected_season_one')and catalogue.get('episode_numbers')==list(range(1,9)):
   result['finality']={'state':'confirmed','basis':'Current official publisher evidence: all eight available + final episode; season-one catalogue entries1..8','source_ids':['F1','F2'],'composition_revision':1}
  else:result['limitations'].append('Season finality remains unknown unless BOTH current official evidence conditions hold; no inference from dates, iframe or episode count alone.')
 result['release_evidence']=[]
 if kind=='season' and signals.get('F1',{}).get('all_eight_available') and signals.get('F2',{}).get('selected_season_one'):
  for number in signals['F2'].get('episode_numbers',[]):
   result['release_evidence'].append({'episode_id':scope['id']+':e'+str(number),'state':'publisher_confirmed_released','source_ids':['F1','F2'],'composition_revision':1,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 if not result['documents']:result['limitations'].append('No source acquired; no source-based generation is permitted.')
 return result
