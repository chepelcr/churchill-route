# El Tren al Puerto — investigación para La Ruta del Churchill

Investigación del 27 de octubre de 2026. Estado: **base documental y propuesta de campaña histórica**. El MVP previo y su flujo integrado se trasladaron a la rama `feature/pacific-railway`; ver [continuidad para Claude](../../PACIFIC_RAILWAY_HANDOFF.md). Nombre de trabajo: **El Tren al Puerto**.

La identidad propuesta es viajar desde la Estación del Pacífico hasta Puntarenas, reconociendo el ferrocarril, los pueblos y el paisaje costarricense. La campaña puede terminar enlazando con las entregas de churchill del juego existente. La conducción conserva el control manual solicitado: acelerar delante del tren, frenar detrás, intensidad según distancia del dedo y flechas en escritorio.

## Lo que ya podemos mapear

Se extrajo el corredor de un snapshot real de OpenStreetMap distribuido por [Geofabrik](https://download.geofabrik.de/central-america/costa-rica.html), con estado de replicación **2026-10-27 21:23:59 UTC**. Los resultados son mediciones propias sobre esa geometría:

- **114,999 km** desde Pacífico hasta el punto de llegada cercano al antiguo depósito de Puntarenas; **115,781 km** incluyendo el ramal cartografiado hacia el muelle.
- **1.761 vértices**, 82 vías OSM distintas y 21 puntos candidatos a checkpoints. Las posiciones de llegada son aproximadas y se documentan en el catálogo.
- Recorrido continuo por conexiones reales entre nodos OSM, sin dibujar enlaces para tapar huecos.
- La [relación ferroviaria 14070544](https://www.openstreetmap.org/relation/14070544) por sí sola tiene dos componentes. Fue necesario incorporar siete vías conectadas del mismo extracto. Sus IDs están en [route-audit.json](data/route-audit.json).
- Según las etiquetas del extracto, unos 18,792 km son `rail` y 96,988 km `disused`. Una etiqueta `rail` no acredita servicio actual; continuidad cartográfica tampoco acredita estado físico ni transitabilidad.

El corredor sigue Pacífico → La Sabana → Pavas → Belén → Ojo de Agua → Turrúcares → Río Grande/Atenas → Balsa → Escobal → Quebradas → Orotina → Coyolar → La Ceiba → Salinas → Caldera → Barranca → El Roble → Chacarita → Puntarenas. No hay que desviar la ruta principal al centro de Heredia, Alajuela o Esparza para incluir sus nombres: hay servicios o ramales diferentes.

Las fuentes históricas hablan de longitudes distintas. El dictamen histórico de la [Procuraduría](https://www.pgrweb.go.cr/DOCS/Dictamenes/1/P/J/2000-2009/2005-2009/2005/8EBC7.html) recoge 133,926 km; la ficha municipal de [Atenas](https://www.atenasmuni.go.cr/articulo/antigua-estacion-n-0-19-de-atenas) sitúa su estación a 38 km de San José y 78 de Puntarenas. No son cifras intercambiables con nuestra medición: cambiaron tramos, variantes y terminales. Falta conciliar planos por época antes de afirmar una longitud histórica única.

## Escenarios con referencias concretas

| Lugar | Qué debe reconocerse | Evidencia y trabajo pendiente |
|---|---|---|
| Estación del Pacífico | Fachada art déco, volúmenes horizontales, marquesina y entorno urbano | El edificio actual se terminó en 1941; no confundirlo con la apertura de la línea en 1910. [Sicultura](https://adminsi.cultura.cr/infraestructura/estacion-del-ferrocarril-al-pacifico-san-jose). Foto `pacifico`. |
| Belén / Ojo de Agua / Turrúcares | Cambio gradual de ciudad a poblaciones, campos y cortes de terreno | Geometría OSM disponible; faltan fotos propias de andenes, cruces y vegetación de estos tramos. No inventar monumentos. |
| Puente ferroviario Río Grande | Estructura de acero y cañón profundo; apoyos vinculados al terreno | La municipalidad documenta 219,38 m de longitud y 105 m sobre el río. [Ficha municipal](https://www.atenasmuni.go.cr/articulo/puente-ferroviario-rio-grande). Foto `rio-grande-puente`; añadir vista lateral de referencia antes del arte definitivo. |
| Estación de Río Grande de Atenas | Madera sobre zócalo, bodega y andén; museo ferroviario | El edificio reemplaza al destruido por incendio en 1933; museo abierto en 2001. [Municipalidad](https://www.atenasmuni.go.cr/articulo/antigua-estacion-n-0-19-de-atenas). Fotos `atenas-estacion`, `atenas-locomotora`. |
| Escobal | Estación de dos plantas de concreto y antigua función telegráfica | Construida en 1939. [Municipalidad](https://www.atenasmuni.go.cr/articulo/antigua-estacion-del-ferrocarril-de-escobal). Foto fechada en enero de 2026. |
| Quebradas | Terraza superior voladiza y relación con bodega y corral | Construcción de 1937 e inauguración en 1939. [Municipalidad](https://www.atenasmuni.go.cr/articulo/antigua-estacion-del-tren-de-quebradas). Falta fotografía abierta adecuada. |
| Orotina | Estación y locomotora patrimonial como hito | Fotografías y cronología en la [Municipalidad de Orotina](https://muniorotina.go.cr/index.php/el-canton/citytour). Ver catálogo para Siemens 130. No colocar el mercado sobre las vías si está fuera del corredor. |
| Jesús María / sector Salinas | Río, puentes y paisaje de transición hacia la costa | Localización de cada puente y de las variantes históricas pendiente. La continuidad de la ruta OSM sí está resuelta. |
| Caldera / Roca Carballo | Estación elevada, corredores, costa y relieve rocoso | Estación de 1936–1940; dejó su función ferroviaria en 1989. [Sicultura](https://adminsi.cultura.cr/infraestructura/antigua-estacion-del-ferrocarril-caldera). Foto `caldera`, enero de 2026. |
| Barranca / El Roble / Chacarita | Entrada progresiva al paisaje costero y tejido urbano | OSM aporta el corredor. Hay que documentar puentes, agua y vegetación local por tramo; evitar usar un fondo genérico en toda la costa. |
| Puntarenas / muelle | Península, corredor urbano, depósito histórico y llegada al puerto | Foto de vías de 2026; depósito en archivo de la Library of Congress. El final exacto y el ramal al muelle deben revisarse por época. No asumir que el tren recorría el actual muelle de cruceros hasta su extremo. |

El libro académico del [CIICLA/UCR](https://ciicla.ucr.ac.cr/sites/default/files/2025-05/Libro-SonidosImagenesLetras_ConPaginasBlancas_compressed.pdf) ayuda a contextualizar el corredor, el ramal de Esparza y los pasos costeros. Sus fotografías requieren revisar derechos individualmente; se usa como referencia documental.

## Locomotoras y época

El catálogo reúne **13 referencias, 11 fotografías descargadas** con procedencia y licencia individual. Abrir [galería](photo-gallery.html) o [fichas y créditos](PHOTO-REFERENCES.md).

Tres familias aportan identidad propia:

1. **María Cecilia N.º 1**, locomotora de vapor Dickson de 1898: candidata a capítulo de memoria o colección de museo.
2. **AEG eléctricas**, incluyendo la N.º 3: referencia de la electrificación iniciada alrededor de 1930; las fechas de obras e inauguración no deben condensarse en una sola sin contexto.
3. **Henschel–Siemens 130–133**, llegadas en 1957: candidatas a tren principal por su relación con el corredor y librea nacional. La fotografía municipal de la 130 sirve de referencia; no se identificó licencia abierta para redistribuirla.

Las identidades y cronología se contrastan con [Orotina](https://muniorotina.go.cr/index.php/el-canton/citytour) y el artículo de [Revista Herencia/UCR](https://archivo.revistas.ucr.ac.cr/index.php/herencia/article/download/43299/43535/159368). Las fotografías preservadas muestran estados y fechas diferentes. La ficha de María Cecilia tiene discrepancia entre fecha declarada y EXIF; no usarla para reconstruir una fecha exacta.

**Propuesta editorial:** un viaje patrimonial de recuperación imaginada, con fichas que expliquen qué se documenta y qué se reconstruye. Permite representar estaciones cuidadas sin atribuir al presente un servicio San José–Puntarenas no confirmado. La [información de INCOFER](https://www.incofer.go.cr/incofer/nosotros/) y sus [proyectos estratégicos](https://www.incofer.go.cr/incofer/proyectos-estrategicos/proyecto-tren-pacifico-central/) se mantienen separados de la reconstrucción histórica. Si se elige una fecha histórica estricta, hay que fijar vehículo, infraestructura y terminales de esa época antes de producir los assets.

## Terreno y animación

Sí conviene poner terreno bajo la vía: terraplenes, cortes, laderas, cauces y costa. El vacío bajo el tren debe corresponder a puentes o pasos elevados identificados. Se muestreó terreno publicado en **Mapzen Terrain Tiles / Skadi** cada 100 m: 1.158 muestras, de 0 a 1.159 m. [Fuente AWS](https://registry.opendata.aws/terrain-tiles/) y [atribuciones](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

Es elevación del **suelo**, no de la plataforma ferroviaria. En un puente el tablero debe seguir su perfil propio sobre el cañón; en un túnel no debe seguir la montaña. No derivar pendientes de conducción directamente de este muestreo. `terrain-profile.json` conserva origen, tiles y checksums.

El mapa de relieve incorpora otras **4.551 muestras regionales** de DEM, con curvas por intervalos de 200 m. Se localizaron **12 cruces entre puentes ferroviarios y ríos** mediante intersección de geometrías OSM. [river-crossings.json](data/river-crossings.json) conserva coordenadas, IDs de vía/río y perfiles de terreno de 1,2 km siguiendo el eje del puente, cada 20 m; ese paso de muestreo no aumenta la resolución original del DEM.

**Dirección de arte solicitada:** ríos al fondo de cañones, peñascos y paredes altas en los sectores montañosos, con vegetación local, roca expuesta, taludes y apoyos del puente asentados. El Río Grande es el hito documentado con 105 m de altura del puente sobre el río. El cruce del Río Concepción, alrededor del km 55,31, muestra relieve vecino importante en el DEM y queda como candidato para documentación fotográfica. No asignar los 105 m a todos los puentes ni convertir una diferencia de terreno cercana en altura certificada de una pared vertical. En Jesús María, esteros y Barranca debe prevalecer su paisaje real, sin trasladarles acantilados genéricos.

El DEM de vista general está separado de las cotas puntuales y no resuelve por sí solo paredes verticales, geología o forma exacta de los peñascos. El arte definitivo requiere fotos laterales y, si se consigue, topografía de mayor resolución. El [Archivo Nacional](https://archivodigital.go.cr/index.php/informationobject/browse?creators=788091&media=print&page=36&sf_culture=es&sort=startDate&sortDir=desc&topLod=0&view=table) cataloga planos del perfil del puente Río Grande y diagramas de vías: referencias útiles para la siguiente verificación. No confundir este corredor con otros puentes del Virilla en carreteras o en la línea del Atlántico.

La recomendación visual es mantener el dibujo y animaciones de Churchill, con cámara cenital para el recorrido cartográfico y posible vista lateral en escenas ferroviarias. La decisión de cámara queda abierta; ambas deben compartir distancia sobre la vía y checkpoints. Las estaciones y puentes serán landmarks únicos. Los fondos repetibles se reservan para capas lejanas, con continuidad de bordes comprobada; no repetir una estación patrimonial como textura.

## Nueve niveles propuestos

Los kilómetros son acumulados medidos sobre OSM, no postes kilométricos oficiales. La división es de diseño y puede ajustarse sin alterar la geometría fuente.

| Nivel | Tramo | Km acumulados aproximados | Foco de juego |
|---|---|---|---|
| 1 | Pacífico → Belén | 0–14,34 | Salida, acelerar/frenar, cruces y detención en andén |
| 2 | Belén → Turrúcares | 14,34–30,23 | Transición rural y control de velocidad |
| 3 | Turrúcares → Atenas | 30,23–37,29 | Aproximación y cruce del Río Grande |
| 4 | Atenas → Escobal | 37,29–49,84 | Curvas, Balsa y cañones |
| 5 | Escobal → Orotina | 49,84–66,13 | Quebradas y estaciones rurales |
| 6 | Orotina → La Ceiba | 66,13–76,26 | Coyolar y paisaje agrícola |
| 7 | La Ceiba → Salinas | 76,26–88,80 | Descenso hacia el litoral; puentes por documentar |
| 8 | Salinas → Barranca | 88,80–101,80 | Caldera, costa y relieve |
| 9 | Barranca → Puntarenas | 101,80–115,00 | El Roble, Chacarita y llegada al puerto |

El ramal final 115,00–115,78 km queda como epílogo opcional sujeto a validación. Habrá selección de nivel y viaje completo con progreso persistente. Puentes y pasos pueden ser checkpoints de paso; las estaciones elegidas, checkpoints de parada. La velocidad y tiempos de parada del juego serán valores de diseño, identificados como tales. Ver [spec.md](spec.md), [stack.md](stack.md) y [levels.proposed.json](data/levels.proposed.json).

## Incertidumbres que no deben convertirse en arte definitivo

- Fijar época/ficción editorial y cámara. No mezclar todos los edificios y vehículos como si fueran de 1910.
- Georreferenciar **Cambalache, Miraflores y Carballo** con planos y fotos. Los `tunnel=yes` encontrados cerca de El Roble no prueban que sean esos túneles históricos.
- Validar por separado ruta principal, accesos a Caldera, variantes costeras y llegada histórica al puerto.
- El punto del puente Río Grande usa una cámara georreferenciada cercana, no el centro certificado de la estructura.
- En Caldera una lista secundaria ubica la estación unos 590 m fuera del punto respaldado por foto de 2026 y edificio OSM. Se adoptó este último, conservando el desacuerdo.
- Completar fotos de Belén, Ojo de Agua, Turrúcares, Quebradas, Orotina, Jesús María, Barranca y terminal de Puntarenas; idealmente consultar archivo de INCOFER, museos y vecinos para nombres y detalles.

## Archivos y reproducción

- [Ruta segmentada GeoJSON](data/pacifico-puntarenas-route.geojson), [GPX](data/pacifico-puntarenas.gpx), [checkpoints](data/checkpoints.geojson), [CSV](data/checkpoints.csv).
- [Auditoría](data/route-audit.json), [fuente y hash](data/source.json), datos OSM originales del corredor y perfil de terreno en `data/`.
- `extract_osm.py`: requiere `osmium`; recibe el PBF como argumento. `build_route.py`: biblioteca estándar; reconstruye ruta y checkpoints; DEM opcional vía `--dem-dir`.
- `build_elevation.py --dem-dir carpeta`: toma `N09W085.hgt.gz` y `N10W085.hgt.gz`, genera relieve regional y cruces de río. `build_map_data.py` prepara una versión compacta para explorar el mapa.
- `build_research.py`: genera niveles propuestos, galería y fichas a partir del catálogo. `download_photos.py`: descarga referencias aprobadas sin sobrescribir originales.
- `python3 validate_research.py`: comprueba continuidad, distancias, referencias, niveles y hashes; no valida explotación ferroviaria.

Datos derivados de OpenStreetMap: **© OpenStreetMap contributors**, [ODbL 1.0](https://www.openstreetmap.org/copyright). Mantener atribución visible en el mapa y conservar procedencia al redistribuir la base. Licencias fotográficas independientes en el catálogo. Esta carpeta conserva la evidencia y los datos fuente; no reemplaza el mundo generado. La integración jugable está documentada en `docs/PACIFIC_RAILWAY_HANDOFF.md`.
