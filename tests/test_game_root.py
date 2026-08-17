"""LA FRONTERA ENTRE EL BUILDER Y EL JUEGO, y cuán angosta es.

El builder y el juego van a vivir en repositorios separados: el builder con el
extracto de OSM y el contenido autorado, el juego con sólo el juego. Este
archivo es lo que hace ese corte posible y lo que lo mantiene angosto.

**LA FRONTERA SON OCHO RUTAS EN CUATRO ARCHIVOS**, y ese número es la propiedad
que importa. El builder ESCRIBE el mundo emitido y los dos artefactos del
vocabulario; LEE cuatro registros compartidos (superficies, flora, las medidas
en metros, los tipos de NPC). Nada más cruza. Una novena ruta no es
necesariamente mala, pero tiene que ser una decisión y no un descuido — que es
para lo que existe esta prueba.

`CHURCHILL_GAME_ROOT` es el nombre del editor, no uno nuevo: el editor contesta
esta misma pregunta desde que existe, y dos nombres para un concepto es
exactamente cómo se separan.
"""
import os
import re
import subprocess
import sys
import unittest

from churchill.world import config

ROOT = config.ROOT

#: Cada archivo del builder al que se le permite mirar dentro del juego, con las
#: rutas que usa. Agregar una fila es una decisión deliberada.
BOUNDARY = {
    os.path.join("churchill", "world", "config.py"): {
        ("src", "world2d"),                      # escribe: el mundo emitido
        ("src", "assets", "surfaces.json"),      # lee: la clase de superficie
        ("src", "assets", "flora.json"),         # lee: especies y mezclas
        ("src", "assets", "world-units.json"),   # lee: las medidas en metros
    },
    os.path.join("churchill", "world", "service", "npc.py"): {
        ("src", "game", "npcTypes.json"),        # lee: dónde puede pararse un NPC
    },
    os.path.join("tools", "gen_vocabulary.py"): {
        ("src", "domain", "vocabulary.generated.js"),      # publica
        ("src", "assets", "vocabulary.generated.json"),    # publica
    },
    os.path.join("tools", "world_snapshot.py"): {
        ("src", "world2d"),                      # verifica lo emitido
    },
}

#: Los archivos del builder que se recorren buscando cruces. `tests/` queda
#: fuera a propósito: 21 de sus 24 módulos leen el juego, y ésa es justamente la
#: deuda que se paga portándolos a JS — no una frontera que este archivo cuide.
SCANNED = ("churchill", "tools")


def crossings(path):
    """Las rutas hacia `src/` que un archivo construye."""
    with open(path, encoding="utf-8") as fh:
        src = re.sub(r"^\s*#.*$", "", fh.read(), flags=re.M)
    out = set()
    for match in re.finditer(r'os\.path\.join\(\s*(?:GAME_)?ROOT\s*,\s*([^)]*)\)', src):
        parts = re.findall(r'"([^"]+)"', match.group(1))
        if parts and parts[0] == "src":
            out.add(tuple(parts))
    return out


class BoundaryTests(unittest.TestCase):
    def test_only_the_declared_files_reach_into_the_game(self):
        found = {}
        for base in SCANNED:
            for dirpath, _, files in os.walk(os.path.join(ROOT, base)):
                if "__pycache__" in dirpath:
                    continue
                for name in files:
                    if not name.endswith(".py"):
                        continue
                    full = os.path.join(dirpath, name)
                    hits = crossings(full)
                    if hits:
                        found[os.path.relpath(full, ROOT)] = hits
        self.assertEqual(
            set(found), set(BOUNDARY),
            "the builder→game boundary changed. Adding a crossing is allowed; "
            "adding one WITHOUT declaring it here is how a clean split rots.")
        for rel, hits in found.items():
            with self.subTest(file=rel):
                self.assertEqual(hits, BOUNDARY[rel])

    def test_every_crossing_goes_through_GAME_ROOT(self):
        """Una ruta del juego construida sobre `ROOT` funciona hoy —los dos
        valores coinciden en un solo checkout— y deja de funcionar en el momento
        en que se separan. Ese es el fallo que no avisa: el build escribe en el
        lugar equivocado y no dice nada."""
        for rel in BOUNDARY:
            with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
                src = re.sub(r"^\s*#.*$", "", fh.read(), flags=re.M)
            bad = re.findall(r'os\.path\.join\(\s*ROOT\s*,\s*"src"', src)
            with self.subTest(file=rel):
                self.assertEqual(bad, [], f"{rel} builds a GAME path off ROOT")

    def test_the_default_is_a_single_checkout(self):
        """Sin la variable, todo se comporta como siempre. Un corte que exige
        configurar algo para que el caso normal funcione no se adopta."""
        self.assertEqual(config.GAME_ROOT, config.ROOT)


class SeparateCheckoutTests(unittest.TestCase):
    """…y que de verdad REDIRIGE, que es otra cosa que declararlo."""

    def test_the_paths_move_with_the_variable(self):
        # UN GAME ROOT DE VERDAD, aunque sea mínimo. `config.py` lee
        # `world-units.json` AL IMPORTAR y a propósito no tolera que falte —
        # «un builder que se invente su propia cuadrícula porque un asset no
        # está es justamente la deriva silenciosa que esto cierra». Así que un
        # `/tmp/inexistente` no prueba la redirección: prueba esa regla.
        import shutil
        import tempfile
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        for parts in (("src", "assets"), ("src", "game")):
            os.makedirs(os.path.join(tmp, *parts), exist_ok=True)
        for rel in (("src", "assets", "world-units.json"),
                    ("src", "assets", "surfaces.json"),
                    ("src", "assets", "flora.json"),
                    ("src", "game", "npcTypes.json")):
            shutil.copy(os.path.join(ROOT, *rel), os.path.join(tmp, *rel))
        code = (
            "from churchill.world.config import GAME_ROOT, WORLD2D_DIR, "
            "SURFACE_REGISTRY_PATH, WORLD_UNITS_PATH\n"
            "import churchill.world.service.npc as npc\n"
            "print(GAME_ROOT); print(WORLD2D_DIR); print(SURFACE_REGISTRY_PATH);"
            "print(WORLD_UNITS_PATH); print(npc.NPC_TYPES_PATH)"
        )
        env = {**os.environ, "CHURCHILL_GAME_ROOT": tmp, "PYTHONPATH": ROOT}
        out = subprocess.run([sys.executable, "-c", code], capture_output=True,
                             text=True, cwd=ROOT, env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        for line in out.stdout.strip().splitlines():
            self.assertTrue(line.startswith(tmp),
                            f"{line} did not follow CHURCHILL_GAME_ROOT")


if __name__ == "__main__":
    unittest.main()
