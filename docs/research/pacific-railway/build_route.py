"""Trace the railway graph without inventing connectors; export research GIS."""
import pathlib,json,math,heapq,collections,csv,gzip,struct,hashlib,argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dem-dir',type=pathlib.Path,help='Folder containing N09W085.hgt.gz and N10W085.hgt.gz; optional')
args=parser.parse_args()
ROOT=pathlib.Path(__file__).parent;DATA=ROOT/'data'
def read(n):return json.loads((DATA/n).read_text())
def save(n,d): (DATA/n).write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
def hav(a,b):
 lon1,lat1,lon2,lat2=map(math.radians,[a[0],a[1],b[0],b[1]])
 return 6371008.8*2*math.asin(min(1,math.sqrt(math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2)))
rails=read('osm-railways.geojson')['features'];ways={f['properties']['osm_id']:f for f in rails};nodes={};g=collections.defaultdict(list)
for f in rails:
 ids=f['properties']['node_ids'];pts=f['geometry']['coordinates'];wid=f['properties']['osm_id']
 for n,p in zip(ids,pts):nodes[n]=p
 for a,b,pa,pb in zip(ids,ids[1:],pts,pts[1:]):
  d=hav(pa,pb);g[a].append((b,d,wid));g[b].append((a,d,wid))
def nearest(pt):return min(g,key=lambda n:hav(nodes[n],pt))
def trace(start,end):
 distances={start:0};prev={};q=[(0,start)]
 while q:
  d,n=heapq.heappop(q)
  if d!=distances[n]:continue
  if n==end:break
  for b,l,w in g[n]:
   nd=d+l
   if nd<distances.get(b,math.inf):distances[b]=nd;prev[b]=(n,w);heapq.heappush(q,(nd,b))
 if end not in distances:raise ValueError('No connected OSM path. Do not draw an invented connector.')
 path=[end];wids=[];n=end
 while n!=start:n,w=prev[n];path.append(n);wids.append(w)
 return list(reversed(path)),list(reversed(wids))
start=nearest([-84.0810605,9.9254769]);depot=nearest([-84.82657,9.97736]);dock=nearest([-84.83310,9.97588])
path,wids=trace(start,dock);depot_path,_=trace(start,depot);coords=[nodes[n] for n in path];cum=[0]
for a,b in zip(coords,coords[1:]):cum.append(cum[-1]+hav(a,b))
features=[];i=0
while i<len(wids):
 j=i+1
 while j<len(wids) and wids[j]==wids[i]:j+=1
 f=ways[wids[i]];tags=f['properties']['tags']
 features.append({'type':'Feature','properties':{'osm_way_id':wids[i],'osm_url':f['properties']['osm_url'],'name':tags.get('name'),'railway':tags.get('railway'),'bridge':tags.get('bridge'),'tunnel':tags.get('tunnel'),'gauge':tags.get('gauge'),'s_start_m':round(cum[i],2),'s_end_m':round(cum[j],2),'version':f['properties']['version'],'timestamp':f['properties']['timestamp'],'evidence':'mapped geometry; not a statement of operational condition'},'geometry':{'type':'LineString','coordinates':coords[i:j+1]}});i=j
fc={'type':'FeatureCollection','attribution':'© OpenStreetMap contributors, ODbL 1.0','source_snapshot':'2026-10-27T21:23:59Z','purpose':'Historical game-route research; not navigation','features':features}
save('pacifico-puntarenas-route.geojson',fc)
save('route-line.json',{'coordinates':coords,'distance_m':cum,'length_m':cum[-1]})
checkpoints=[
 ('pacifico','Estación del Pacífico',[-84.0810605,9.9254769],'osm:node/4636012380',1),
 ('sabana','La Sabana / Contraloría',[-84.1014187,9.9326573],'osm:node/278449879',1),
 ('pavas','Pavas',[-84.1335334,9.9399761],'osm:node/4636012386',1),
 ('belen','San Antonio de Belén',[-84.1849399,9.9784607],'osm:node/4638218346',2),
 ('ojo-agua','Ojo de Agua',[-84.2230223,9.9724193],'osm:node/276524920',2),
 ('turrucares','Turrúcares',[-84.31802,9.96242],'station-list secondary; snap to OSM',3),
 ('rio-grande','Entorno del puente Río Grande (foto)',[-84.351563,9.962997],'Commons geotag; camera position, not bridge center; exact bridge/river intersection in river-crossings.json',3),
 ('atenas','Estación Atenas / Río Grande',[-84.35392,9.96091],'station-list secondary; photo cross-check',4),
 ('balsa','Balsa',[-84.37994,9.94223],'station-list secondary; snap to OSM',4),
 ('escobal','Escobal',[-84.435191,9.934857],'Commons photo geotag 2026-01-24',5),
 ('quebradas','Quebradas',[-84.45253,9.93195],'station-list secondary; heritage source verifies name',5),
 ('orotina','Orotina',[-84.52623,9.91257],'station-list secondary; municipality photo cross-check',6),
 ('coyolar','Coyolar',[-84.56045,9.89614],'station-list secondary; snap to OSM',6),
 ('ceiba','La Ceiba',[-84.59976,9.89936],'station-list secondary; snap to OSM',7),
 ('salinas','Salinas',[-84.6920703,9.9298334],'osm:node/6727793700',8),
 ('caldera','Estación de Caldera',[-84.723990,9.936801],'Commons geotag; matches OSM station outline',8),
 ('barranca','Barranca',[-84.7108164,9.9902861],'osm:way/1226582149 station outline centroid',9),
 ('roble','El Roble',[-84.7419019,9.9779818],'osm:node/13396370937',9),
 ('chacarita','Chacarita',[-84.776754,9.980133],'station-list secondary; snap to OSM',9),
 ('puntarenas','Estación histórica de Puntarenas',[-84.82657,9.97736],'station-list secondary; exact footprint still to validate',9),
 ('muelle','Espuela del muelle de Puntarenas',[-84.83310,9.97588],'OSM mapped railway spur; not an operating station',9)]
out=[]
for id,name,p,source,level in checkpoints:
 k=min(range(len(coords)),key=lambda k:hav(coords[k],p));off=hav(coords[k],p)
 out.append({'type':'Feature','properties':{'id':id,'name':name,'level':level,'s_m':round(cum[k],1),'distance_km':round(cum[k]/1000,2),'source_point':p,'source':source,'snap_distance_m':round(off,1),'confidence':'review' if off>100 or 'secondary' in source or 'camera' in source else 'mapped_or_photo','osm_node_id':path[k],'osm_url':f'https://www.openstreetmap.org/node/{path[k]}'},'geometry':{'type':'Point','coordinates':coords[k]}})
save('checkpoints.geojson',{'type':'FeatureCollection','features':out})
with (DATA/'checkpoints.csv').open('w') as file:
 writer=csv.writer(file);writer.writerow(['id','name','level','km_measured','lon','lat','snap_m','source','confidence'])
 for f in out:
  p=f['properties'];writer.writerow([p['id'],p['name'],p['level'],p['distance_km'],*f['geometry']['coordinates'],p['snap_distance_m'],p['source'],p['confidence']])
gpx='<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Churchill research" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Pacífico–Puntarenas · research, not navigation</name><copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright></metadata><trk><name>Mapped historical railway corridor</name><trkseg>'+''.join(f'<trkpt lat="{p[1]}" lon="{p[0]}"/>' for p in coords)+'</trkseg></trk></gpx>'
(DATA/'pacifico-puntarenas.gpx').write_text(gpx)
relation=next(r for r in read('osm-relations.json') if r['id']==14070544);rids={m['ref'] for m in relation['members'] if m['type']=='w'}
rg=collections.defaultdict(set)
for f in rails:
 if f['properties']['osm_id'] not in rids:continue
 for a,b in zip(f['properties']['node_ids'],f['properties']['node_ids'][1:]):rg[a].add(b);rg[b].add(a)
unseen=set(rg);components=[]
while unseen:
 q=[unseen.pop()];component=set(q)
 while q:
  for n in rg[q.pop()]:
   if n in unseen:unseen.remove(n);component.add(n);q.append(n)
 components.append(component)
status=collections.defaultdict(float)
for f in features:status[f['properties']['railway']]+=f['properties']['s_end_m']-f['properties']['s_start_m']
audit={'snapshot':'2026-10-27T21:23:59Z','method':'Undirected Dijkstra over actual OSM node connections; haversine lengths; no fabricated gap connectors','source_relation':14070544,'relation_version':relation['version'],'relation_components':len(components),'relation_member_ways':len(rids),'route_way_runs':len(features),'route_unique_ways':len(set(wids)),'additional_way_ids':sorted(set(wids)-rids),'point_count':len(path),'length_to_depot_km':round(sum(hav(nodes[a],nodes[b]) for a,b in zip(depot_path,depot_path[1:]))/1000,3),'length_to_muelle_spur_km':round(cum[-1]/1000,3),'railway_tags_km':{k:round(v/1000,3) for k,v in status.items()},'checkpoints_over_100m_from_route':[f['properties'] for f in out if f['properties']['snap_distance_m']>100],'warning':'Graph continuity is not proof that track exists, is safe, passable, or in service. Lifecycle tags and imagery require review.'}
(DATA/'route-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(audit,ensure_ascii=False,indent=2))

# Sample the published Skadi HGT terrain, never present it as rail-deck elevation.
tiles={};tilemeta=[]
for lat in ([9,10] if args.dem_dir else []):
 p=args.dem_dir/f'N{lat:02d}W085.hgt.gz'
 if p.exists():
  raw=gzip.decompress(p.read_bytes());n=math.isqrt(len(raw)//2);assert n*n*2==len(raw);tiles[lat]=(raw,n)
  tilemeta.append({'name':p.name,'url':f'https://s3.amazonaws.com/elevation-tiles-prod/skadi/N{lat:02d}/N{lat:02d}W085.hgt.gz','grid':n,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
if tiles:
 def elev(p):
  lon,lat=p;south=math.floor(lat)
  if south not in tiles:return None
  raw,n=tiles[south];row=round((south+1-lat)*(n-1));col=round((lon+85)*(n-1));value=struct.unpack_from('>h',raw,2*(row*n+col))[0]
  return None if value==-32768 else value
 samples=[];i=0;s=0
 while s<=cum[-1]:
  while i+1<len(cum) and cum[i+1]<s:i+=1
  j=min(i+1,len(cum)-1);t=(s-cum[i])/(cum[j]-cum[i] or 1);p=[coords[i][0]+t*(coords[j][0]-coords[i][0]),coords[i][1]+t*(coords[j][1]-coords[i][1])]
  f=next((f for f in features if f['properties']['s_start_m']<=s<=f['properties']['s_end_m']),features[-1]);tags=f['properties']
  samples.append({'s_m':s,'lon':p[0],'lat':p[1],'terrain_m':elev(p),'structure':'bridge' if tags['bridge'] else 'tunnel' if tags['tunnel'] else 'surface','osm_way_id':tags['osm_way_id']});s+=100
 save('terrain-profile.json',{'source':'Mapzen Terrain Tiles / Skadi; SRTM terrain data courtesy of USGS','sample_spacing_m':100,'tiles':tilemeta,'warning':'Sampled terrain heights, NOT railway deck heights or surveyed gradients. Bridges and tunnels need separate profiles.','samples':samples})
 with (DATA/'terrain-profile.csv').open('w') as file:
  writer=csv.DictWriter(file,fieldnames=list(samples[0]));writer.writeheader();writer.writerows(samples)
