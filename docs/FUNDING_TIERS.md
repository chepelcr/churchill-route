# La Ruta del Churchill — Tiers de apoyo (Ko-fi)

Página: **https://ko-fi.com/churchillroute**
Basado en el plan de funding; alineado con lo YA implementado en la app
(página de agradecimientos + NPCs del servidor + lotes patrocinados — ver
`docs/REMOTE_CONTENT.md`). Cada tier se cumple editando `public/content.json`;
la app lo refleja sin release.

---

## 🥉 Tier 1 — Aprendiz Churchillero · $5 / ₡2 500

**Recompensa:** nombre en la página de **Agradecimientos** del juego (botón ❤
en el menú) y acceso anticipado a las betas (link del APK).

**Cumplimiento (1 línea de JSON):**
```json
{ "name": "María P.", "tier": 1 }
```
→ `supporters` en content.json. Cupos: ilimitados.

---

## 🥈 Tier 2 — Habitante del Puerto · $20–25 / ₡10 000–13 000

**Recompensa:** todo lo del Tier 1 + **un NPC cliente con su nombre** dentro
del juego: aparece pidiendo un churchill ("Entregando a: [nombre]") con una
frase personalizada en la entrega.

**Reglas de la frase:** máx. **26 caracteres** (límite del float de entrega),
sin marcas de terceros, tono familiar. El supporter elige el barrio (de los
abiertos: Faro, Carmen, Paseo, Centro, Playitas).

**Cumplimiento:**
```json
// supporters:
{ "name": "Don Rafa", "tier": 2 }
// npcs (lat/lon reales del punto elegido; el juego lo proyecta y asigna barrio):
{ "id": "kofi_rafa", "name": "Don Rafa", "line": "¡Con mucha leche, porfa!",
  "lat": 9.9770, "lon": -84.8330 }
```
**Cupo sugerido: 30** (más NPCs diluye la probabilidad de que cada uno
aparezca en una partida — el pedido se elige al azar del pool).

---

## 🥇 Tier 3 — Inversor de la Península · $100–150 / ₡50 000–80 000

**Recompensa:** todo lo anterior + **su negocio real en el mapa**: un frente
de local con toldo en sus colores, o una valla publicitaria, en una parcela
real de Puntarenas.

**Reglas:** `label` máx. **14 caracteres** (es lo que se lee en el cartel);
el lugar se elige del catálogo `docs/lotes_catalog.json` (**709 parcelas**
disponibles: Faro 432, Playitas 102, Paseo 74, Carmen 59, Centro 42) o de una
lat/lon libre dentro del área jugable. Vigencia sugerida: 1 año (renovable) —
la vigencia se administra quitando/manteniendo la entrada JSON.

**Cumplimiento:**
```json
// supporters:
{ "name": "Soda La Negra", "tier": 3, "msg": "Paseo de los Turistas" }
// lotes (kind: "store" = frente de local, "billboard" = valla):
{ "id": "L-1a2b3c4d", "kind": "store", "name": "Soda La Negra",
  "label": "LA NEGRA", "lat": 9.9766, "lon": -84.8330, "tone": "#e85d75" }
```
**Cupo sugerido: 15–20 simultáneos** (que el Paseo no parezca un mall).

---

## 👑 Tier "Leyenda Porteña" · $300–500 · LIMITADO A 1–2 CUPOS

**Recompensa:** todo lo anterior + **un kiosco exclusivo brandeado** (uno de
los kioscos base rediseñado con su marca) **o un vehículo personalizado**
(ej. tuk-tuk con su livery) seleccionable en el juego.

**Nota de implementación:** este tier SÍ requiere trabajo de arte/código por
patrocinador (kiosco = variante de landmark; vehículo = entrada en
`VEHICLES` + sprite en `paintVehicle`) — no es solo JSON. Presupuestar ~1 día
de trabajo por cupo; por eso el precio y el límite de cupos.
En Agradecimientos aparece con corona: `{ "name": "…", "tier": 4 }`.

---

## Operativa de cobro y registro

- **Hoy (manual):** el pago entra por Ko-fi → se edita `public/content.json`
  → push → live en horas (web) / al reabrir la app (APK, caché 6h).
- **Futuro (automático):** Ko-fi **no tiene MCP oficial**, pero sí
  **webhooks**: manda un POST por cada pago a la URL que se configure
  (Settings → API en Ko-fi). El backend futuro (ROADMAP → Server-side)
  recibirá ese webhook y agregará el supporter Tier 1 automáticamente;
  los tiers 2–3 quedan con moderación manual (validar frase/marca) antes de
  publicar. Referencia: https://help.ko-fi.com/hc/en-us/articles/360004162298
- Los montos en colones son referencia; Ko-fi cobra en USD.
