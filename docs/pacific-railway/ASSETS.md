# Assets y procedencia

39 recursos de producción, cada uno en SVG y PNG:

| Carpeta | Cantidad | Contenido |
| --- | ---: | --- |
| track | 15 | Rectas, pendientes, 4 transiciones, cima, valle, estación, cadena, frenos y 3 loops |
| cars | 9 | Frente, medio y cola × Alpino, Menta Express y Medianoche |
| scenery | 9 | Poste, arriostre, pie de soporte, 2 pinos, roca, nube, bandera y techo de estación |
| backgrounds | 6 | Cielo, nubes, montañas, colinas, bosque y panorama compuesto |

`manifest.json` documenta cada archivo. Los rieles normales tienen un lienzo de 288 × 352 px y pivote `(16,160)`. Los loops tienen lienzos y pivotes propios, declarados en el manifest. Los carritos miden 176 × 112 px con pivote `(86,100)`.

Los rieles, carros, escenarios y capas transparentes tienen alpha real. El cielo y el panorama compuesto son opacos. Los PNG se exportan a escala 1; SVG permite ampliar sin pérdida. Las capas del fondo miden 2048 × 1024; las columnas de los bordes coinciden y la pendiente visual en los extremos es constante.

El atlas `atlas/coaster-kit.png` contiene los 33 sprites de rieles/carros/escenarios en 2048 × 2048. `atlas/coaster-kit.json` declara los frames sin recortar, tamaño fuente, pivote normalizado y separación de 4 px. Los fondos permanecen separados para repetirlos.

## Paleta

Tinta `#203e3c`; riel `#315f59`; luz de riel `#cde4d5`; madera `#bc8d5a`; terracota `#eb6b3a`; crema `#fff5de`. Las variantes de tren cambian la pintura y conservan silueta y puntos de contacto.

## Marca de Pacific Code Labs

Fuente aprobada: repositorio `pacific-code-labs`, archivo `fe/landing/src/content/branding.json`, que apunta a `brand/logo/pcl_l1_primary.svg` y `pcl_l2_reverse.svg`. Los PNG 2× correspondientes son del **17 de octubre de 2026**. La ruta entre checkouts puede cambiar; los originales aprobados ya se incluyen en este kit.

Se copiaron sin modificar:

- `pcl_l1_primary_2x.png` → `branding/pacific-code-labs-primary.png`.
- `pcl_l2_reverse_2x.png` → `branding/pacific-code-labs-reverse.png`.

El logo se presenta completo, conserva proporción y no se reconstruye con texto separado. La variante reverse se usa en la carga, el menú y ajustes. No se usa la imagen anterior de Churchill.

## Tipografías

Los archivos locales Bungee y Space Grotesk proceden de los paquetes `@fontsource` ya presentes en el proyecto de referencia. Se incluyen las licencias originales SIL Open Font License en `assets/fonts/`. La marca de Pacific Code Labs conserva su propia composición.

## Ilustración conceptual generada

`backgrounds/alpine-valley-concept.png` fue creada con la herramienta integrada ImageGen, sin imágenes de referencia. Se conserva en su resolución original como dirección artística. La versión de producción del fondo se construyó como SVG determinista para garantizar continuidad horizontal y capas independientes.

Prompt final usado (inglés):

```text
Use case: illustration-story. Asset type: one production background PNG for a side-scrolling 2D roller coaster game. Create a wide landscape panorama, approximately 2:1 aspect ratio, a beautiful sunny alpine adventure park valley with a refined hand-painted storybook / contemporary travel-poster style, subtle paper grain, softly shaped detailed foliage, crisp appealing silhouettes. View exactly side-on to match a 2D game, no isometric perspective. Composition: upper 58 percent is very spacious pale warm ivory-to-sky-blue open sky with only a few slender quiet cream clouds. Distant pale blue-green mountain range along the lower half, including an elegant large mountain peak on the right and quieter hills toward the left. Layered sage green pine forests, tiny warm terracotta rocks and trees around a meadow in the lowest 20 percent. Color palette warm creamy ivory, misty turquoise, muted eucalyptus green, pine green, terracotta orange accents. Gentle morning sunlight, inviting adventurous tranquil mood. This background must leave abundant free sky through the center and upper half for compositing roller coaster rails and vehicles later. Landscape only: absolutely NO roller coaster, tracks, vehicles, people, buildings, text, letters, labels, borders, UI, or logos. The full canvas is opaque, edge to edge. High resolution, polished game-ready illustration.
```

Las referencias locales sirvieron para inspeccionar estilo y marca; este proyecto no depende de esas carpetas al ejecutarse.
