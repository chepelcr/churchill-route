"""Re-download approved photo references. Does not change reviewed metadata."""
import pathlib,json,subprocess,hashlib
ROOT=pathlib.Path(__file__).parent
for p in json.loads((ROOT/'photo-catalog.json').read_text()):
    if not p.get('local_file'): continue
    target=ROOT/p['local_file']
    if target.exists(): continue
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_suffix('.download')
    subprocess.run(['curl','-fL','--retry','2','--max-time','60','-A','ChurchillResearch/1.0',p['image_url'],'-o',str(temporary)],check=True)
    raw=temporary.read_bytes()
    if raw[:2]!=b'\xff\xd8' or hashlib.sha256(raw).hexdigest()!=p['sha256']:
        temporary.unlink(); raise ValueError(f'Unexpected content for {p["id"]}; review source changes manually.')
    temporary.rename(target)
