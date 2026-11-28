"""Sync the publications archive from the repository and the Instagram kit."""
import csv
import json
import re
import shutil
import subprocess
from pathlib import Path

SITE = Path(__file__).resolve().parent
PUBLICATIONS = SITE.parent
REPO = PUBLICATIONS.parents[1]
KIT = PUBLICATIONS / "Kit_Instagram_Churchill"
DIST = SITE / "dist"
MEDIA = DIST / "media"
ROUND = "instagram"
ARCHIVE = "archivo"


def copy(source, name=None):
    if not source.is_file():
        raise FileNotFoundError(source)
    target = MEDIA / (name or source.name)
    shutil.copyfile(source, target)
    return "media/" + target.name


def photo(source, name):
    target = MEDIA / (name + ".jpg")
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "high",
             "-Z", "1000", str(source), "--out", str(target)],
            check=True, stdout=subprocess.DEVNULL,
        )
    return "media/" + target.name


def articles():
    photos = {
        "2026-07-24": "13_paseo", "2026-07-25-catedral": "03_catedral",
        "2026-07-25-estadios": "02_estadio_lito_perez", "2026-07-27-calles": "13_paseo",
        "2026-07-27-parcelas": "04_parque_mora_y_canas",
        "2026-08-14": "20_plaza_las_playitas", "2026-08-15": "03_catedral_noche",
        "2026-08-17-el-cielo": "01_faro_noche", "2026-08-17-el-puerto": "13_paseo",
    }
    feed = KIT / "02_capturas_actuales/feed_1080x1350"
    for path in sorted(PUBLICATIONS.glob("20*.md"), reverse=True):
        if path.stem == "2026-11-26-como-entrar-y-recorrer":
            continue
        lines = path.read_text().splitlines()
        title = lines[0].lstrip("# ").strip()
        title = {
            "2026-11-14-trailer": "El tráiler de La Ruta del Churchill",
            "2026-11-14-la-punta-y-el-paseo": "La Punta y el Paseo",
            "2026-11-12-las-playitas": "Las Playitas, en tres versiones",
        }.get(path.stem, title)
        block = re.search(r"```text\s*\n(.*?)\n```", "\n".join(lines), re.S)
        intro = "\n".join(lines[1:]).strip().split("\n\n", 1)[0].replace("\n", " ")
        caption = block[1] if block else re.sub(r"^[> ]+", "", intro)
        media = []
        poster = next((feed / (value + ".png") for prefix, value in photos.items() if path.stem.startswith(prefix)), None)
        if path.stem == "2026-11-14-trailer":
            poster = PUBLICATIONS / "img/punta/01-punta.jpg"
            trailer = REPO / "trailer/renders/churchill-trailer-vertical-redes.mp4"
            if trailer.is_file():
                media.append({"type": "video", "url": copy(trailer)})
        elif path.stem == "2026-11-14-la-punta-y-el-paseo":
            for image in sorted((PUBLICATIONS / "img/punta").glob("[0-9]*.jpg")):
                media.append({"type": "image", "url": photo(image, image.stem), "alt": image.stem[3:].replace("-", " ")})
            media.append({"type": "download", "url": copy(PUBLICATIONS / "zip/la-punta-y-el-paseo-instagram.zip"),
                          "label": "Descargar carrusel"})
        elif path.stem == "2026-11-12-las-playitas":
            folder = PUBLICATIONS / "img/2026-11-12-las-playitas"
            for name in ("publicacion-las-playitas.png", "brochure-tres-versiones.png"):
                media.append({"type": "image", "url": photo(folder / name, Path(name).stem), "alt": "Las Playitas"})
        if poster:
            poster = photo(poster, "archivo-" + path.stem)
        else:
            poster = next((item["url"] for item in media if item["type"] == "image"), None)
        yield {
            "id": path.stem, "campaign": ARCHIVE, "title": title, "date": path.stem[:10],
            "format": "Video" if any(item["type"] == "video" for item in media) else ("Carrusel" if media else "Artículo"),
            "caption": caption, "cover": poster, "media": media,
            "source": copy(path), "isCopy": block is not None,
        }


def round_posts():
    with (KIT / "04_plan_y_textos/Calendario_4_semanas.csv").open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    for row in rows:
        number = int(row["n"])
        media = []
        for index, relative in enumerate(row["archivos"].split(" | "), 1):
            path = KIT / relative
            if number == 2:
                path = KIT / "Fotos_nuevas_Matadero_y_Faro/feed_1080x1350" / path.name
            if not path.is_file():
                raise FileNotFoundError(path)
            if path.suffix == ".mp4":
                media.append({"type": "video", "url": copy(path)})
            else:
                media.append({"type": "image", "url": photo(path, f"ig-{number:02}-{index:02}"),
                              "alt": path.stem.split("_", 1)[-1].replace("_", " ")})
        cover = next((item["url"] for item in media if item["type"] == "image"), None)
        yield {
            "id": f"instagram-{number:02}", "campaign": ROUND, "number": number,
            "title": row["titulo"], "date": row["dia"], "week": int(row["semana"]),
            "format": "Reel" if number == 3 else "Carrusel", "caption": row["caption"], "isCopy": True,
            "cover": cover, "media": media,
        }


def matadero():
    folder = KIT / "Fotos_nuevas_Matadero_y_Faro"
    media = [
        {"type": "image", "url": photo(image, image.stem), "alt": image.stem[3:].replace("_", " ")}
        for image in sorted((folder / "feed_1080x1350").glob("30_*.png"))
    ]
    return {
        "id": "antiguo-matadero", "campaign": ROUND, "title": "El Antiguo Matadero",
        "date": "Extra", "format": "Carrusel", "cover": media[0]["url"], "media": media, "isCopy": True,
        "caption": (folder / "Publicacion_Antiguo_Matadero.txt").read_text().strip(),
    }


def main():
    MEDIA.mkdir(parents=True, exist_ok=True)
    copy(KIT / "Plan_Instagram_Churchill.pdf")
    copy(KIT / "04_plan_y_textos/Plan_Instagram_Churchill.md")
    copy(KIT / "04_plan_y_textos/Calendario_4_semanas.csv")
    copy(KIT / "Catalogo_visual.pdf")
    copy(KIT / "01_identidad_original/icono_app_192.png", "churchill.png")
    copy(KIT / "05_portada_facebook/Portada_Facebook_Churchill.png")
    copy(REPO / "node_modules/@fontsource/bungee/files/bungee-latin-400-normal.woff2", "bungee.woff2")
    copy(REPO / "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2", "space-400.woff2")
    copy(REPO / "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2", "space-700.woff2")
    photo(PUBLICATIONS / "img/punta/01-punta.jpg", "hero-puntarenas")
    posts = [*round_posts(), matadero(), *articles()]
    payload = json.dumps(posts, ensure_ascii=False).replace("<", "\\u003c")
    (DIST / "publicaciones.js").write_text("window.PUBLICACIONES = " + payload + ";\n", encoding="utf-8")
    print(f"{len(posts)} publicaciones en {DIST}")


if __name__ == "__main__":
    main()
