"""One-shot developer metadata acquisition. Never requests torrent payload pieces.
Native cache GETs first, then bounded BEP9 in upload-only/default-don't-download mode.
Not an app server, persistent service, webseed or browser delivery claim.
"""
import hashlib, json, os, pathlib, tempfile, time, urllib.request
import libtorrent as lt
OUT=pathlib.Path('artifacts/metadata-control');OUT.mkdir(parents=True,exist_ok=True)
HASHES=['f288db0e01560e7989b105a494a1d8e3674faaa8','7eebe91290da5dc0e209296e654a71d0aa8d73e2','13978ae18c7b67fba9ee4ea2863d832943c955c2']
CAP=1048576
rows=[]
def accept(raw,expected,method):
    if len(raw)>CAP: raise ValueError('METADATA_SIZE_LIMIT')
    parsed=lt.bdecode(raw);info=parsed[b'info'];encoded=lt.bencode(info)
    actual=hashlib.sha1(encoded).hexdigest()
    if actual!=expected: raise ValueError('INFOHASH_MISMATCH')
    # Only hash-verified info is retained; announce URLs/comments are unnecessary.
    clean=lt.bencode({b'info':info});(OUT/(actual+'.torrent')).write_bytes(clean)
    ti=lt.torrent_info(clean);fs=ti.files()
    return {'infoHash':actual,'hashVerified':True,'method':method,'metadataBytes':len(clean),'files':[{'fileIdx':i,'path':fs.file_path(i),'length':fs.file_size(i)} for i in range(fs.num_files())]}
for infohash in HASHES:
    row={'infoHash':infohash,'attempts':[],'videoPayloadBytes':0};rows.append(row)
    for host,url in [('itorrents.net',f'https://itorrents.net/torrent/{infohash.upper()}.torrent'),('itorrents.org',f'https://itorrents.org/torrent/{infohash.upper()}.torrent'),('torrage.info',f'https://torrage.info/torrent.php?h={infohash}'),('btcache.me',f'https://btcache.me/torrent/{infohash.upper()}')]:
        try:
            with urllib.request.urlopen(url,timeout=8) as r:
                raw=r.read(CAP+1);row['attempts'].append({'host':host,'status':r.status,'bytes':len(raw),'acao':r.headers.get('access-control-allow-origin')})
            row.update(accept(raw,infohash,'native HTTPS '+host));break
        except Exception as e: row['attempts'].append({'host':host,'error':type(e).__name__})
    (OUT/'metadata.json').write_text(json.dumps({'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'rows':rows},ensure_ascii=False,indent=2)+'\n')
pending=[r for r in rows if not r.get('hashVerified')]
if pending:
    ses=lt.session({'enable_lsd':False,'enable_upnp':False,'enable_natpmp':False,'connections_limit':30,'alert_mask':int(lt.alert.category_t.error_notification | lt.alert.category_t.status_notification)})
    with tempfile.TemporaryDirectory() as tmp:
        handles=[]
        for row in pending:
            p=lt.parse_magnet_uri('magnet:?xt=urn:btih:'+row['infoHash'])
            p.save_path=tmp
            p.flags |= lt.torrent_flags.upload_mode | lt.torrent_flags.default_dont_download
            p.flags &= ~lt.torrent_flags.auto_managed
            h=ses.add_torrent(p)
            for url in ['udp://tracker.opentrackr.org:1337/announce','udp://open.stealth.si:80/announce','udp://tracker.torrent.eu.org:451/announce']:
                h.add_tracker({'url':url})
            handles.append((row,h))
        start=time.monotonic()
        while handles and time.monotonic()-start<180:
            for row,h in handles[:]:
                s=h.status();row['nativePeers']=s.num_peers;row['videoPayloadBytes']=s.total_payload_download
                if s.total_payload_download: h.pause();raise RuntimeError('PAYLOAD_UNEXPECTED')
                if h.has_metadata():
                    h.pause()
                    try: row.update(accept(lt.bencode({b'info':lt.bdecode(h.torrent_file().metadata())}),row['infoHash'],'developer native BEP9 metadata-only'))
                    except Exception as e: row['error']=type(e).__name__+':'+str(e)[:80]
                    ses.remove_torrent(h);handles.remove((row,h))
            ses.pop_alerts();time.sleep(.2)
        for row,h in handles: h.pause();row['error']='BEP9_METADATA_TIMEOUT';ses.remove_torrent(h)
        ses.pause()
for row in rows: print(row['infoHash'],row.get('hashVerified',False),row.get('method',row.get('error')),row.get('metadataBytes'),row.get('videoPayloadBytes'))
(OUT/'metadata.json').write_text(json.dumps({'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scope':'one-shot native developer metadata; not browser/WebRTC payload evidence','rows':rows},ensure_ascii=False,indent=2)+'\n')
