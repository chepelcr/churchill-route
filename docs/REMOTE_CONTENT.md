# Remote content — supporters, server NPCs y lotes patrocinados

La app carga UN endpoint JSON al arrancar y con eso alimenta la página de
agradecimientos, el pool de NPCs y los lotes patrocinados del mapa. **Editar
ese JSON actualiza la app sin release** (web y APK igual — el APK lo consulta
por red y cachea la última copia buena; offline usa el caché o el default
empacado, el juego nunca depende de la red).

- **Endpoint actual ("servidor" v0):** `https://churchill.jcampos.dev/content.json`
  = `public/content.json` en el repo → editarlo + push = publicar contenido.
- **Futuro:** una API real puede servir el MISMO esquema en la misma URL
  (`CONTENT_URL` en `src/content/remote.js`); el cliente no cambia.
- Cliente: `src/content/remote.js` (fetch con timeout 6s, caché localStorage
  TTL 6h stale-while-revalidate, sanitización de todos los campos).

## Esquema (version 1)

```jsonc
{
  "version": 1,
  "meta": { "kofi": "https://ko-fi.com/TU_HANDLE" },   // null = botón oculto

  // Página de agradecimientos (tiers del plan de funding, 1..4)
  "supporters": [
    { "name": "María P.", "tier": 1 },
    { "name": "Soda El Puerto", "tier": 3, "msg": "gracias por el apoyo" }
  ],

  // NPCs del servidor. Si la lista NO está vacía, REEMPLAZA el pool de
  // clientes empacado (plan a largo plazo: todos los NPCs vienen del server).
  // Posición por lat/lon reales (el cliente proyecta con meta.geo del
  // manifest) o por x/y de mundo. "line" ≤ 26 caracteres.
  "npcs": [
    { "id": "kofi_maria", "name": "María P.", "line": "¡El mío con leche!",
      "lat": 9.9784, "lon": -84.8274 }
  ],

  // Lotes patrocinados: negocios reales de Puntarenas en el mapa.
  // kind: "store" (frente de local con toldo) | "billboard" (valla).
  // Elegir el lugar del catálogo docs/lotes_catalog.json (o lat/lon libre).
  "lotes": [
    { "id": "L-1a2b3c4d", "kind": "store", "name": "Soda La Negra",
      "label": "LA NEGRA", "lat": 9.9766, "lon": -84.8330, "tone": "#e85d75" }
  ]
}
```

## Catálogo de lotes (admin)

`python3 tools/gen_lotes.py` → `docs/lotes_catalog.json`: **709 parcelas
candidatas** en el área jugable del MVP (faro 432, playitas 102, paseo 74,
carmen 59, centro 42), cada una con id estable (hash del centroide), x/y,
lat/lon reales, tamaño y distrito. Flujo para un patrocinador Tier 3:
1. Elegir un lote del catálogo (por distrito/tamaño).
2. Copiar su `id` + `lat`/`lon` a una entrada en `lotes` de `content.json`
   con la marca (`label` ≤ 14 chars, `tone` del negocio).
3. Push → aparece en el juego (valla o frente de local + etiqueta).
Regenerar el catálogo tras cualquier rebuild del mundo (los ids son estables
mientras la geometría no cambie).

## Reglas de validación (las aplica el cliente)

- `supporters[].name` ≤ 40 chars, `tier` 1–4, `msg` ≤ 80.
- `npcs[].line` ≤ 26 (el float de entrega corta ahí), `name` ≤ 26; fuera del
  mundo → descartado; distrito asignado por `districtAt` (los NPCs en zonas
  MVP-bloqueadas se filtran solos).
- `lotes[].label` ≤ 14 (se dibuja en el cartel), `kind` ∈ {store, billboard}.
