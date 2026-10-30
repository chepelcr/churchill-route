"""Sample real terrain and locate OSM bridge/river intersections for research."""
import argparse,pathlib,json,gzip,struct,math,hashlib
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dem-dir',type=pathlib.Path,required=True)
args=parser.parse_args()
ROOT=pathlib.Path(__file__).parent/'data'
read=lambda n:json.loads((ROOT/n).read_text())
def save(n,d):(ROOT/n).write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
tiles={};sources=[]
for south in [9,10]:
    name=f'N{south:02}W085.hgt.gz';p=args.dem_dir/name
    raw=gzip.decompress(p.read_bytes());n=math.isqrt(len(raw)//2)
    assert n*n*2==len(raw)
    tiles[south]=(raw,n)
    sources.append(dict(name=name,url=f'https://s3.amazonaws.com/elevation-tiles-prod/skadi/N{south:02}/{name}',sha256=hashlib.sha256(p.read_bytes()).hexdigest(),grid=n))
def elev(lon,lat):
    south=math.floor(lat);raw,n=tiles[south]
    y=round((south+1-lat)*(n-1));x=round((lon+85)*(n-1))
    v=struct.unpack_from('>h',raw,2*(y*n+x))[0]
    return None if v==-32768 else v
bbox=[-84.90,9.80,-84.02,10.12];w,h=111,41
values=[elev(bbox[0]+x/(w-1)*(bbox[2]-bbox[0]),bbox[3]-y/(h-1)*(bbox[3]-bbox[1])) for y in range(h) for x in range(w)]
save('elevation-grid.json',dict(bbox=bbox,width=w,height=h,row_order='north_to_south',sample='nearest HGT cell; approx 880 m preview grid',values=values,sources=sources,attribution='Mapzen Terrain Tiles / Skadi; SRTM terrain data courtesy of USGS',warning='Terrain surface elevations, not track-deck elevation. Coarse overview cannot resolve individual cliffs.'))
rails=read('pacifico-puntarenas-route.geojson')['features']
rivers=[f for f in read('osm-context.geojson')['features'] if f['properties']['tags'].get('waterway')=='river']
def intersect(a,b,c,d):
    rx,ry=b[0]-a[0],b[1]-a[1];sx,sy=d[0]-c[0],d[1]-c[1];den=rx*sy-ry*sx
    if abs(den)<1e-15:return None
    t=((c[0]-a[0])*sy-(c[1]-a[1])*sx)/den;u=((c[0]-a[0])*ry-(c[1]-a[1])*rx)/den
    return [a[0]+t*rx,a[1]+t*ry] if 0<=t<=1 and 0<=u<=1 else None
def hav(a,b):
    x1,y1,x2,y2=map(math.radians,[*a,*b]);v=math.sin((y2-y1)/2)**2+math.cos(y1)*math.cos(y2)*math.sin((x2-x1)/2)**2
    return 6371008.8*2*math.asin(min(1,math.sqrt(v)))
crossings=[]
for f in rails:
    rp=f['properties']
    if not rp['bridge']:continue
    pts=f['geometry']['coordinates'];s=rp['s_start_m']
    for a,b in zip(pts,pts[1:]):
        for river in rivers:
            rpts=river['geometry']['coordinates'];prop=river['properties']
            if max(p[0] for p in rpts)<min(a[0],b[0]) or min(p[0] for p in rpts)>max(a[0],b[0]) or max(p[1] for p in rpts)<min(a[1],b[1]) or min(p[1] for p in rpts)>max(a[1],b[1]):continue
            for c,d in zip(rpts,rpts[1:]):
                point=intersect(a,b,c,d)
                if point is None:continue
                if any(v['rail_osm_way_id']==rp['osm_way_id'] and hav(v['coordinates'],point)<3 for v in crossings):continue
                lon,lat=point;dx=(b[0]-a[0])*math.cos(math.radians(lat));dy=b[1]-a[1];length=math.hypot(dx,dy);nx=dx/length;ny=dy/length
                section=[]
                for off in range(-600,601,20):
                    x=lon+nx*off/(111195*math.cos(math.radians(lat)));y=lat+ny*off/111195
                    section.append(dict(offset_m=off,terrain_m=elev(x,y)))
                left=[v['terrain_m'] for v in section if v['offset_m']<-80 and v['terrain_m'] is not None];right=[v['terrain_m'] for v in section if v['offset_m']>80 and v['terrain_m'] is not None]
                floor=elev(lon,lat);relief=min(max(left),max(right))-floor if floor is not None else None
                crossings.append(dict(id='river-crossing-'+str(rp['osm_way_id']),name=prop['tags'].get('name','Río sin nombre en el extracto'),coordinates=point,s_m=round(s+hav(a,point),1),rail_osm_way_id=rp['osm_way_id'],river_osm_way_id=prop['osm_id'],rail_source=rp['osm_url'],river_source=prop['osm_url'],terrain_at_river_m=floor,transverse_section=section,nearby_relief_estimate_m=relief,relief_method='Lower of maximum terrain on each side (80–600 m) minus DEM at river crossing. Not cliff height, track clearance or a surveyed cross-section.',bridge_deck_m=None,documented_clearance_m=105 if rp['osm_way_id']==68846134 else None,clearance_source='https://www.atenasmuni.go.cr/articulo/puente-ferroviario-rio-grande' if rp['osm_way_id']==68846134 else None,art_direction='River below bridge; high rocky canyon walls with local vegetation where reference confirms exposed rock; preserve approach slopes and land support.',rock_faces_status='photo_and_documented_canyon_reference' if rp['osm_way_id']==68846134 else 'terrain_candidate_requires_photo_review'))
        s+=hav(a,b)
crossings.sort(key=lambda p:p['s_m'])
save('river-crossings.json',dict(status='OSM geometry intersections with DEM exploration; art proposal, not engineering survey',sources=sources,crossings=crossings))
print('Elevation grid:',w*h,'samples; river crossings:',len(crossings))
for c in crossings:print(c['name'],round(c['s_m']/1000,2),'km; ground',c['terrain_at_river_m'],'m; nearby relief estimate',c['nearby_relief_estimate_m'],'m; documented clearance',c['documented_clearance_m'])
