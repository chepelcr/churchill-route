"""Research snapshot only; never writes generated Churchill world files.

Requires pyosmium: python3 -m pip install osmium
Usage: python3 extract_osm.py costa-rica-261027.osm.pbf
"""
import sys, json, pathlib, hashlib, math, collections
import osmium

ROOT=pathlib.Path(__file__).parent
BOX=(-84.90,9.80,-84.02,10.12)
def inside(lon,lat):return BOX[0]<=lon<=BOX[2] and BOX[1]<=lat<=BOX[3]
def feature(kind,id,tags,geometry,version=None,timestamp=None,nodes=None):
 p={'osm_type':kind,'osm_id':id,'osm_url':f'https://www.openstreetmap.org/{kind}/{id}','tags':tags}
 if version is not None:p['version']=version
 if timestamp is not None:p['timestamp']=str(timestamp)
 if nodes is not None:p['node_ids']=nodes
 return {'type':'Feature','properties':p,'geometry':geometry}

class Extract(osmium.SimpleHandler):
 def __init__(self):super().__init__();self.rail=[];self.stations=[];self.context=[];self.relations=[]
 def node(self,n):
  t=dict(n.tags)
  if not t or not n.location.valid() or not inside(n.location.lon,n.location.lat):return
  g={'type':'Point','coordinates':[n.location.lon,n.location.lat]}
  if t.get('railway') in ['station','halt','stop']:self.stations.append(feature('node',n.id,t,g,n.version,n.timestamp))
  if t.get('place') in ['city','town','village']:self.context.append(feature('node',n.id,t,g))
 def way(self,w):
  t=dict(w.tags)
  rail=t.get('railway') in ['rail','disused','abandoned','razed','construction','preserved'] or any(t.get(k)=='rail' for k in ['disused:railway','abandoned:railway','razed:railway'])
  station=t.get('railway') in ['station','halt']
  context=t.get('waterway')=='river' or t.get('natural')=='coastline' or t.get('highway') in ['motorway','trunk','primary']
  if not(rail or station or context):return
  pts=[[n.lon,n.lat] for n in w.nodes if n.location.valid()]
  if len(pts)<2 or not any(inside(*p) for p in pts):return
  f=feature('way',w.id,t,{'type':'LineString','coordinates':pts},w.version,w.timestamp,[n.ref for n in w.nodes])
  if rail:self.rail.append(f)
  elif station:
   f['geometry']={'type':'Point','coordinates':[sum(p[0] for p in pts)/len(pts),sum(p[1] for p in pts)/len(pts)]};f['properties']['point_method']='centroid of station outline';self.stations.append(f)
  else:self.context.append(f)
 def relation(self,r):
  t=dict(r.tags)
  if t.get('route') in ['train','railway'] or t.get('route_master')=='train':
   self.relations.append({'id':r.id,'version':r.version,'timestamp':str(r.timestamp),'tags':t,'members':[{'type':m.type,'ref':m.ref,'role':m.role} for m in r.members]})

if __name__=='__main__':
 p=pathlib.Path(sys.argv[1]);h=Extract();h.apply_file(str(p),locations=True,idx='flex_mem')
 for name,features in [('osm-railways',h.rail),('osm-stations',h.stations),('osm-context',h.context)]:
  (ROOT/'data'/f'{name}.geojson').write_text(json.dumps({'type':'FeatureCollection','attribution':'© OpenStreetMap contributors; ODbL 1.0','source':'Geofabrik Costa Rica extract, 2026-10-27','bbox':BOX,'features':features},ensure_ascii=False,separators=(',',':'))+'\n')
 ids={f['properties']['osm_id'] for f in h.rail}
 relations=[r for r in h.relations if any(m['type']=='w' and m['ref'] in ids for m in r['members'])]
 (ROOT/'data/osm-relations.json').write_text(json.dumps(relations,ensure_ascii=False,indent=2)+'\n')
 header=osmium.io.Reader(str(p)).header()
 meta={'source_url':'https://download.geofabrik.de/central-america/costa-rica-261027.osm.pbf','source_bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','bbox':BOX,'railway_ways':len(h.rail),'stations':len(h.stations),'context_features':len(h.context),'route_relations':len(relations),'railway_tags':dict(collections.Counter(f['properties']['tags'].get('railway','lifecycle') for f in h.rail)),'header':{k:header.get(k) for k in ['osmosis_replication_timestamp','osmosis_replication_sequence_number','generator']}}
 (ROOT/'data/source.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');print(json.dumps(meta,ensure_ascii=False))
