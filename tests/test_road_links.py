"""LOS EMPALMES DE CALLE — dos puntas que el mapeador dejó sin unir.

El norte del mapa (Pitahaya y toda su tierra firme) llevaba tiempo SIN CONEXIÓN
POR TIERRA y nada lo decía: medido sobre el mundo emitido, la red manejable
tenía 69 componentes, la península era una de 4 228 466 celdas y el norte otra
de 162 945, y en 600 px a la redonda se acercaban en un solo punto — un corte de
95,5 px al final de la Calle del Arreo.

Esa clase de fallo arranca bien, dibuja bien y no tira nada. Sólo se descubre
manejando hasta el borde, o midiendo. Estas pruebas fijan las tres decisiones
que hacen que no vuelva a pasar en silencio.
"""
import math
import unittest

from churchill.world.content import ROAD_LINK_DEFS
from churchill.world.service.roadlink import link_roads


def road(name, pts, cls="unclassified", w=41, **extra):
    r = {"cls": cls, "w": w, "pts": list(pts)}
    if name:
        r["name"] = name
    r.update(extra)
    return r


#: proyección de juguete: un grado de más = 1000 px, para que las anclas del
#: fixture se lean como coordenadas y no como magia.
def project(lat, lon):
    return ((lon + 85.0) * 1000.0, (lat - 10.0) * 1000.0)


class LinkingTests(unittest.TestCase):
    def setUp(self):
        # dos cabos que mueren a 100 px uno de otro, como el de la Calle del Arreo
        self.roads = [road(None, [0, 0, 250, 0]), road(None, [350, 0, 600, 0])]

    def spec(self, **over):
        base = {"id": "t", "from": [10.0, -84.75], "to": [10.0, -84.65],
                "reachM": 19.2}     # 60 px a 3.125 px/m
        base.update(over)
        return base

    def test_it_joins_the_two_ends_and_inherits_the_street_it_continues(self):
        made = link_roads(self.roads, project, [self.spec()])
        self.assertEqual(len(made), 1)
        self.assertEqual(len(self.roads), 3)
        link = self.roads[-1]
        self.assertEqual(link["pts"], [250, 0, 350, 0])
        self.assertEqual(link["link"], "t")
        # LA CLASE Y EL ANCHO SALEN DE LA VÍA QUE CONTINÚA. Un empalme es el
        # pedazo que le faltaba a una calle que ya existe; darle un ancho propio
        # lo dibujaría como otra cosa.
        self.assertEqual(link["cls"], "unclassified")
        self.assertEqual(link["w"], 41)
        self.assertAlmostEqual(made[0]["gap"], 100.0)

    def test_the_surface_of_the_street_carries_over(self):
        self.roads[0]["barro"] = 1
        link_roads(self.roads, project, [self.spec()])
        self.assertEqual(self.roads[-1].get("barro"), 1,
                         "un empalme de una calle de barro no puede salir asfaltado")

    def test_an_anchor_that_resolves_to_nothing_FAILS_the_build(self):
        """La regla que ya cobró el centro cívico entero.

        Un elemento hecho a mano que resuelve a nada no puede desaparecer con un
        WARN que nadie lee: el reescalado de 2.0 a 2.5 movió las manzanas 4 000
        px y siete hitos del centro dejaron de existir exactamente así.
        """
        # un ancla a 500 px de cualquier punta, con alcance de 60
        with self.assertRaises(SystemExit):
            link_roads(self.roads, project, [self.spec(**{"from": [10.5, -84.75]})])

    def test_it_refuses_to_tie_a_street_to_itself(self):
        # las dos anclas sobre la MISMA vía serían un lazo, no un empalme
        with self.assertRaises(SystemExit):
            link_roads([road(None, [0, 0, 250, 0])], project,
                       [self.spec(to=[10.0, -85.0 + 0.0])])

    def test_only_the_ENDS_are_candidates_never_a_middle_vertex(self):
        """Engancharse a un vértice INTERIOR haría una T donde el mapeador no
        puso ninguna.

        El fixture pone un vértice del medio a 10 px del ancla y las dos puntas
        de verdad a más de 400. Un empalme que mirara todos los vértices lo
        cosería ahí encantado; el correcto no encuentra nada y **falla el
        build**, que es la respuesta honesta: si hace falta un empalme a media
        calle, se autora a media calle a propósito.
        """
        self.roads = [road(None, [0, 0, 250, 0]),
                      road(None, [600, -400, 340, 0, 600, 400])]
        with self.assertRaises(SystemExit):
            link_roads(self.roads, project, [self.spec()])


class AuthoredLinksTests(unittest.TestCase):
    def test_every_authored_link_is_geo_and_carries_its_reason(self):
        self.assertTrue(ROAD_LINK_DEFS, "se perdió el empalme de la Calle del Arreo")
        for spec in ROAD_LINK_DEFS:
            self.assertIn("id", spec)
            self.assertIn("note", spec, f"{spec.get('id')} sin razón escrita")
            for key in ("from", "to"):
                lat, lon = spec[key]
                # EN GEO, NUNCA EN PÍXELES: este mundo lleva cuatro reescalados y
                # un campo de deformación puesto y quitado.
                self.assertTrue(8 < lat < 12, f"{spec['id']}.{key} no parece lat")
                self.assertTrue(-87 < lon < -82, f"{spec['id']}.{key} no parece lon")
            # EN METROS, y convertido por el servicio — no por `METRE_KEYS`,
            # que le quitaría la llave a los tres servicios que ya la leen cruda.
            self.assertGreater(spec["reachM"], 0)

    def test_the_list_stays_short_on_purpose(self):
        """Hay 1 568 extremos libres en el mundo y 128 pares a menos de 100 px.

        Soldarlos con una regla inventaría calles por todo el mapa, y sólo se
        vería conduciendo. Por eso se autora uno por uno. Si esta lista crece
        más allá de una docena, la decisión de NO tener una regla general hay
        que volver a tomarla — con la medición delante, no por costumbre.
        """
        self.assertLessEqual(len(ROAD_LINK_DEFS), 12)


if __name__ == "__main__":
    unittest.main()
