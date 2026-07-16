# Monetización — estado de implementación y pasos operativos

Basado en el plan `churchill_monetization_funding.md` (AdMob + IAP vía plugins
de Capacitor). Este doc registra **qué ya está en el código** y **qué falta
hacer en consolas externas** antes del release de Play Store.

## Implementado en el código (branch world-2d)

- **`src/monetize/ads.js`** — AdMob vía `@capacitor-community/admob@8`:
  - *Interstitial* cada **3 partidas terminadas** (pantalla de resultados);
    se omite si el jugador compró "Quitar anuncios". Contador en localStorage.
  - *Rewarded video* = botón **"Seguir +60s (ver anuncio)"** en resultados
    cuando se pierde una partida con timer (arcade/historia), una vez por
    partida (`state.usedAdContinue`). La recompensa se otorga SOLO en el
    evento `Rewarded` del plugin.
  - En web / dev todo es no-op (import dinámico; no infla el bundle web).
  - **IDs actuales = IDs PÚBLICOS DE PRUEBA de Google** (`ca-app-pub-394025…`).
- **`src/monetize/iap.js`** — `cordova-plugin-purchase@13`:
  - Producto único **`remove_ads`** (NON_CONSUMABLE, Google Play).
  - Flujo: `approved → verify → verified → finish`; entitlement persistido en
    localStorage (`churchill_noads_v1`) + restaurable con "Restaurar compras".
    Sin backend (suficiente para un unlock único, como indica el plan).
- **`AndroidManifest.xml`** — `com.google.android.gms.ads.APPLICATION_ID`
  con el App ID de PRUEBA (comentario TODO al lado).
- **UI** — Ajustes (⚙): comprar/restaurar "Quitar anuncios" (precio localizado
  cuando la tienda carga); Resultados: botón de continue con rewarded.

## Pendiente (consolas externas — no es código)

1. **AdMob** (https://apps.admob.com): crear cuenta, registrar la app →
   `App ID` real; crear 2 Ad Units (Interstitial + Rewarded). Reemplazar:
   - `APPLICATION_ID` en `android/app/src/main/AndroidManifest.xml`
   - `TEST_INTERSTITIAL` / `TEST_REWARDED` en `src/monetize/ads.js`
   - Quitar `initializeForTesting` en `ads.init()`.
2. **Play Console**: cuenta de desarrollador ($25), cuenta de mercader,
   producto gestionado **`remove_ads`**; **pruebas cerradas: 20 testers ×
   14 días** antes de producción (política para cuentas nuevas).
3. **Ficha**: política de privacidad (URL pública — ahora obligatoria además
   por AdMob), clasificación de contenido, ícono 512, capturas.
4. **Target SDK ≥ 34** — verificar `android/variables.gradle` al armar el AAB
   (`bundleRelease`, no APK, para Play).

## Decisiones de diseño

- El rewarded "continue" NO se bloquea con la compra de quitar anuncios —
  es un beneficio que el jugador pide, no publicidad intrusiva.
- Sin banners: en un juego de manejo tapan la vista; solo interstitial de
  baja frecuencia + rewarded opcional.
- Funding/crowdfunding (tiers Kickstarter/Patreon/SINPE del plan) queda
  fuera del código por ahora; los tiers 2/3 (NPC patrocinado, valla en el
  Paseo) se pueden implementar como `CUSTOMER_DEFS`/landmarks cuando haya
  patrocinadores reales.
