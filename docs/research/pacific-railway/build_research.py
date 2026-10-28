"""Build research deliverables, not production levels or generated game world."""
import json, pathlib, html
ROOT = pathlib.Path(__file__).parent
def read(name): return json.loads((ROOT/name).read_text())
def write(name, data): (ROOT/name).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
cp = read('data/checkpoints.geojson')['features']
points = {p['properties']['id']: p for p in cp}
bounds = ['pacifico', 'belen', 'turrucares', 'atenas', 'escobal', 'orotina', 'ceiba', 'salinas', 'barranca', 'puntarenas']
scenes = ['urban-central-valley', 'valley-rural', 'rio-grande-gorge', 'atenas-gorges', 'rural-stations', 'orotina-agriculture', 'pacific-descent', 'caldera-coast', 'puntarenas-peninsula']
levels = []
for i, (a,b) in enumerate(zip(bounds,bounds[1:]),1):
    start,end = [points[k]['properties']['s_m'] for k in (a,b)]
    levels.append(dict(id=f'pacific-{i:02}', number=i, from_checkpoint=a, to_checkpoint=b, source_s_start_m=start, source_s_end_m=end, source_length_m=round(end-start,1), scene=scenes[i-1], checkpoint_ids=[p['properties']['id'] for p in cp if start<=p['properties']['s_m']<=end], game_speed_limits=None, rail_deck_profile=None, status='proposal_requires_art_and_game_validation'))
write('data/levels.proposed.json',dict(schema_version=1,status='research_proposal_not_executable_game_levels',route='pacifico-puntarenas-route.geojson',distance_basis='Haversine metres measured on OSM snapshot 2026-10-27; not official chainage',levels=levels,epilogue=dict(from_checkpoint='puntarenas',to_checkpoint='muelle',status='historical_alignment_and_terminal_review_required')))
photos=read('photo-catalog.json')
esc=lambda x:html.escape(str(x),quote=True)
cards=[]
md=['# Referencias fotográficas y créditos','', 'Catálogo de investigación del 27 de octubre de 2026. Originales sin modificar. Las fechas y descripciones de las fichas no sustituyen una verificación histórica. Las fotos son referencias; no se han integrado como assets del juego.','']
for p in photos:
    url=p['page_url'];license_url=p.get('license_url');local=p.get('local_file')
    credit=f"{p['author']} · {p.get('date','fecha no identificada')} · {p['license']}"
    pic=f'<a href="{esc(local)}"><img loading="lazy" src="{esc(local)}" alt="{esc(p["label"])}"></a>' if local else '<p>Referencia disponible en la fuente enlazada.</p>'
    cards.append(f'<article><h2>{esc(p["label"])}</h2>{pic}<p>{esc(credit)}</p><p><a href="{esc(url)}">Ficha original</a>'+ (f' · <a href="{esc(license_url)}">Licencia / derechos</a>' if license_url else '')+f'</p><p>{esc(p.get("notes",""))}</p></article>')
    md += [f'## {p["label"]}', '', f'- ID: `{p["id"]}`.', f'- Autor: {p["author"]}. Fecha: {p.get("date","no identificada")}.',f'- [Ficha original]({url}).', f'- Licencia: [{p["license"]}]({license_url})' if license_url else f'- Derechos: {p["license"]}.',f'- Archivo: [{local}]({local}) (original sin modificar).' if local else '- Solo enlace de referencia; sin copia local.',f'- Nota: {p["notes"]}' if p.get('notes') else '', '']
(ROOT/'PHOTO-REFERENCES.md').write_text('\n'.join(md)+'\n')
(ROOT/'photo-gallery.html').write_text('''<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>El Tren al Puerto · referencias fotográficas</title>
<style>html{color-scheme:light dark}body{font:16px/1.5 system-ui;max-width:1100px;margin:auto;padding:24px}h1{font-size:2rem}h2{font-size:1.2rem}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:28px}img{width:100%;height:240px;object-fit:contain;background:light-dark(#f0eee8,#202522)}article{border-bottom:1px solid light-dark(#ddd,#555);padding-bottom:16px}a{color:light-dark(#165e66,#8ad4dd)}p{overflow-wrap:anywhere}</style>
<h1>El Tren al Puerto</h1><p>Referencias fotográficas · fuentes, fechas y créditos individuales. Investigación de octubre de 2026.</p>
<p><a href="README.md">Investigación</a> · <a href="PHOTO-REFERENCES.md">Créditos completos</a> · <a href="photo-catalog.json">Catálogo para agentes</a></p>
<main>'''+''.join(cards)+'</main></html>\n')
print(f'Built {len(levels)} proposed levels and gallery of {len(photos)} references.')
