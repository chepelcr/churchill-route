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

## Formato de publicación: AAB (obligatorio)

**Sí, Play Store exige `.aab`** para apps nuevas desde agosto 2021 — el `.apk`
NO se puede subir a producción. El APK del sitio (`/churchill.apk`) sigue
siendo válido para instalar por fuera de Play (sideload). Para Play:

```
pnpm build && npx cap sync android
cd android && ./gradlew bundleRelease
# -> android/app/build/outputs/bundle/release/app-release.aab
```

Firmado con el mismo keystore; al crear la app en Play Console conviene
activar **Play App Signing** (Google guarda la clave de firma final y tu
keystore pasa a ser la "upload key").

## Checklist de cumplimiento — políticas de Google Play

Estado a 2026-07 (verificar contra las políticas vigentes al momento del
release en https://play.google.com/console → Policy Center):

1. **Data Safety form (obligatoria)** — AdMob recolecta identificadores de
   dispositivo (AAID) e info de diagnóstico aunque el juego no recolecte nada:
   declarar "Device or other IDs" + "Advertising" como propósito, compartido
   con terceros (Google). Sin esto la app se rechaza.
2. **Política de privacidad (obligatoria, doblemente)** — Play la exige para
   toda app con Data Safety, y AdMob la exige por contrato. URL pública (puede
   vivir en churchill.jcampos.dev/privacy). Debe mencionar AdMob/identificadores
   y el enlace a los ads settings de Google.
3. **Consentimiento (GDPR/EEA + UMP)** — AdMob exige el **User Messaging
   Platform (UMP)** para usuarios del EEE/UK: crear el mensaje de consentimiento
   en AdMob → Privacy & messaging, y llamar `AdMob.requestConsentInfo()` /
   `showConsentForm()` antes de cargar ads (el plugin `@capacitor-community/
   admob` los expone). TODO en `ads.init()` cuando existan los IDs reales.
4. **Ads policy** — cumplimos por diseño: interstitials solo entre partidas
   (pantalla de resultados, nunca "unexpected"), cerrables, sin banners que
   tapen gameplay, rewarded 100% opt-in con recompensa clara. NO mostrar ads
   en el primer arranque (grace de 3 partidas lo garantiza).
5. **Target audience & Families** — el juego es familiar visualmente; si se
   declara audiencia que incluye <13, aplican las **Families Ads Policies**
   (solo redes certificadas, sin AAID). Recomendación: declarar **13+** para
   usar AdMob normal; el content rating (IARC) saldrá "Everyone" igualmente.
6. **Content rating (IARC)** — cuestionario en Play Console; sin violencia
   real/apuestas → rating bajo. Declarar que contiene ads y compras.
7. **Target API level** — desde el **31-ago-2026** las apps NUEVAS deben
   apuntar a **API 36** (Android 16); las existentes a ≥35. Nuestro
   `android/variables.gradle` ya está en `targetSdkVersion = 36` ✓ (verificado
   2026-07-16; extensión posible hasta nov-2026 si hiciera falta).
8. **Cuenta nueva: pruebas cerradas** — **12 testers × 14 días continuos**
   antes de pedir acceso a producción (política para cuentas personales
   creadas después de nov-2023; Google la bajó de 20 a 12 en dic-2024 — el
   plan original decía 20). No aplica a cuentas de organización.
9. **Declaración de compras** — "Quitar anuncios" aparece en la ficha como
   "In-app purchases"; el flujo IAP ya usa Google Play Billing (obligatorio;
   pasarelas externas prohibidas para bienes digitales).
10. **Sin login/cuentas** — no aplica la política de account deletion.

## Decisiones de diseño

- El rewarded "continue" NO se bloquea con la compra de quitar anuncios —
  es un beneficio que el jugador pide, no publicidad intrusiva.
- Sin banners: en un juego de manejo tapan la vista; solo interstitial de
  baja frecuencia + rewarded opcional.
- Funding/crowdfunding (tiers Kickstarter/Patreon/SINPE del plan) queda
  fuera del código por ahora; los tiers 2/3 (NPC patrocinado, valla en el
  Paseo) se pueden implementar como `CUSTOMER_DEFS`/landmarks cuando haya
  patrocinadores reales.
