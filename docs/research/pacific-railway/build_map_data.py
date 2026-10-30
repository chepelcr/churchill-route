"""Simplify sourced OSM context for the conversation map; full GIS stays intact."""
import json,pathlib,math
ROOT=pathlib.Path(__file__).parent/'data'
def read(n):return json.loads((ROOT/n).read_text())
def simplify(pts,tol=.00035):
    if len(pts)<3:return pts
    a,b=pts[0],pts[-1];dx=b[0]-a[0];dy=b[1]-a[1];den=dx*dx+dy*dy
    def distance(p):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(den or 1)))
        return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
    i=max(range(1,len(pts)-1),key=lambda i:distance(pts[i]))
    if distance(pts[i])<=tol:return [a,b]
    return simplify(pts[:i+1],tol)[:-1]+simplify(pts[i:],tol)
context=[];places=[]
for f in read('osm-context.geojson')['features']:
    t=f['properties']['tags'];g=f['geometry']
    if g['type']=='Point':
        if t.get('place') in ['city','town'] and t.get('name') in ['San José','Belén','San Antonio','Atenas','Orotina','Esparza','Puntarenas','Alajuela','Heredia','Santa Ana']:
            places.append(dict(name=t['name'],point=g['coordinates']))
        continue
    pts=simplify(g['coordinates'])
    context.append(dict(type='Feature',properties=dict(kind='water' if t.get('waterway') or t.get('natural')=='coastline' else 'road'),geometry=dict(type='LineString',coordinates=[[round(v,5) for v in p] for p in pts])))
line=read('route-line.json')
payload=dict(context=dict(type='FeatureCollection',features=context),places=places,route=line,segments=read('pacifico-puntarenas-route.geojson')['features'],checkpoints=read('checkpoints.geojson')['features'],levels=read('levels.proposed.json')['levels'],terrain=[[s['s_m'],s['terrain_m']] for s in read('terrain-profile.json')['samples']],elevation=read('elevation-grid.json'),rivers=[{k:v for k,v in c.items() if k!='transverse_section'} for c in read('river-crossings.json')['crossings']],source=read('source.json')['source_url'])
(ROOT/'map-preview.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
print('Map payload bytes:',(ROOT/'map-preview.json').stat().st_size)
