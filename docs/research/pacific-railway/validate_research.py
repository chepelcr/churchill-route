"""Validate the research data, not railway conditions or production game levels."""
import pathlib,json,math,hashlib,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).parent
def read(p):return json.loads((ROOT/p).read_text())
route=read('data/route-line.json');coords=route['coordinates'];dist=route['distance_m']
assert len(coords)==len(dist)==1761 and dist[0]==0
assert all(a<b for a,b in zip(dist,dist[1:]))
assert abs(dist[-1]-route['length_m'])<.001
def key(p):return tuple(p)
edges=set()
for f in read('data/osm-railways.geojson')['features']:
    pts=f['geometry']['coordinates']
    for a,b in zip(pts,pts[1:]):edges.add((key(a),key(b)));edges.add((key(b),key(a)))
assert all((key(a),key(b)) in edges for a,b in zip(coords,coords[1:])), 'Invented connector'
features=read('data/pacifico-puntarenas-route.geojson')['features']
for a,b in zip(features,features[1:]):
    assert a['geometry']['coordinates'][-1]==b['geometry']['coordinates'][0]
    assert a['properties']['s_end_m']==b['properties']['s_start_m']
assert abs(sum(f['properties']['s_end_m']-f['properties']['s_start_m'] for f in features)-dist[-1])<.1
cp=read('data/checkpoints.geojson')['features'];ids={f['properties']['id'] for f in cp}
assert len(cp)==len(ids)==21
for f in cp:
    p=f['properties'];assert key(f['geometry']['coordinates']) in set(map(key,coords))
    assert 0<=p['s_m']<=dist[-1]+.1 and p['snap_distance_m']<100 and p['source']
levels=read('data/levels.proposed.json')['levels'];assert len(levels)==9
for l in levels:
    assert l['source_s_start_m']<l['source_s_end_m']
    assert set(l['checkpoint_ids'])<=ids and l['game_speed_limits'] is None
for a,b in zip(levels,levels[1:]):assert a['source_s_end_m']==b['source_s_start_m']
photos=read('photo-catalog.json');count=0
for p in photos:
    assert p['author'] and p['license'] and p['page_url']
    if p.get('local_file'):
        raw=(ROOT/p['local_file']).read_bytes();assert raw[:2]==b'\xff\xd8'
        assert hashlib.sha256(raw).hexdigest()==p['sha256'];count+=1
profile=read('data/terrain-profile.json');assert 'NOT railway deck' in profile['warning']
assert len(profile['samples'])==1158
assert all(s['terrain_m'] is not None for s in profile['samples'])
ET.parse(ROOT/'data/pacifico-puntarenas.gpx')
grid=read('data/elevation-grid.json');assert len(grid['values'])==grid['width']*grid['height']==4551
assert all(isinstance(v,int) for v in grid['values'])
crossings=read('data/river-crossings.json')['crossings'];assert len(crossings)==12
for c in crossings:
    assert 0<c['s_m']<dist[-1] and c['rail_source'] and c['river_source']
    assert c['bridge_deck_m'] is None and len(c['transverse_section'])==61
assert next(c for c in crossings if c['name']=='Río Grande')['documented_clearance_m']==105
print(f'OK: {len(coords)} connected route vertices, {len(cp)} checkpoints, {len(levels)} proposed levels, {count} photo hashes, {len(profile["samples"])} terrain samples, valid GPX.')
print(f'OK: {len(grid["values"])} regional elevation samples and {len(crossings)} OSM river crossings; rail deck elevations kept separate.')
