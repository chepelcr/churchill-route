#!/bin/bash
# Levanta (o relevanta) el servidor de desarrollo de La Ruta del Churchill.
#
#   ./reboot-server.sh              # dev en :8734, el de siempre
#   ./reboot-server.sh 8736         # un servidor FRESCO en otro puerto
#   ./reboot-server.sh --clean      # …y además borra la caché de Vite
#   ./reboot-server.sh --stop       # baja el de ese puerto y no levanta nada
#
# LOS LOGS VIVEN EN EL REPO (`logs/`), no en el espacio temporal de una
# herramienta: así los lee cualquiera —vos, otra sesión, otro agente— con un
# `tail -f` y no hay que preguntarle a nadie dónde quedaron.
#
# LA CACHÉ NO SE BORRA POR DEFECTO, Y ESO ES A PROPÓSITO. `CLAUDE.md` lo dice
# por su nombre: el proceso de Vite en :8734 es PERSISTENTE —módulos, JSON e
# imports nuevos entran por HMR— y matarlo o borrar `node_modules/.vite` como
# parte del ciclo de edición cuesta un arranque en frío cada vez, sin arreglar
# nada. Reiniciar es DIAGNÓSTICO, y sólo después de reproducir un fallo del
# optimizador o de la config; borrar la caché es el último paso, nunca el
# primero. Por eso vive detrás de `--clean`.
#
# Y OJO CON EL PUERTO: las seis smokes que importan módulos fuente
# (`smoke:sky`, `smoke:shadows`, `smoke:sceneshadows`, `smoke:standshadow`,
# `smoke:feria`, `smoke:grade`) tienen que correr contra un servidor FRESCO en
# otro puerto — un :8734 con un ciclo de edición encima parte el grafo de
# módulos y esas pruebas fallan como si el código estuviera mal. De ahí que el
# puerto sea el primer argumento.
set -uo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; MAGENTA='\033[0;35m'; RED='\033[0;31m'; NC='\033[0m'

PORT=8734
CLEAN=0
STOP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --stop)  STOP_ONLY=1 ;;
    ''|*[!0-9]*) echo -e "${RED}argumento no reconocido: $arg${NC}"; exit 2 ;;
    *) PORT="$arg" ;;
  esac
done

LOG="logs/dev-$PORT.log"
mkdir -p logs

# Sólo se mata AL DUEÑO DEL PUERTO, nunca `node` entero: en esta máquina puede
# haber otra sesión, un build o un preview corriendo, y llevárselos por delante
# es peor que el problema que se venía a resolver.
echo "Buscando quién tiene el puerto $PORT..."
PIDS=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "  matando $(echo "$PIDS" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  for _ in $(seq 1 20); do
    lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
  # shellcheck disable=SC2086
  lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1 && kill -9 $PIDS 2>/dev/null || true
else
  echo "  el puerto estaba libre"
fi

if [ "$STOP_ONLY" = "1" ]; then
  echo -e "${GREEN}Puerto $PORT libre. No se levantó nada.${NC}"
  exit 0
fi

if [ "$CLEAN" = "1" ]; then
  echo -e "${YELLOW}Borrando la caché de Vite (pediste --clean; el próximo arranque es en frío)...${NC}"
  rm -rf node_modules/.vite .vite
fi

echo -e "${GREEN}Levantando Vite en :$PORT...${NC}"
nohup pnpm dev --port "$PORT" --strictPort > "$LOG" 2>&1 &
DEV_PID=$!

# Se espera a que el puerto RESPONDA, no un `sleep` a ojo: en frío Vite tarda
# más y un sleep fijo declara éxito antes de tiempo o pierde el arranque.
READY=0
for _ in $(seq 1 120); do
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then READY=1; break; fi
  ps -p "$DEV_PID" > /dev/null 2>&1 || break
  sleep 0.5
done

if [ "$READY" = "1" ]; then
  echo -e "${GREEN}Listo.${NC}"
  echo
  echo -e "${YELLOW}PID:${NC}  $DEV_PID"
  echo -e "${YELLOW}URL:${NC}  ${MAGENTA}http://localhost:$PORT/${NC}"
  echo -e "${YELLOW}Log:${NC}  tail -f $LOG"
  echo
  echo -e "${YELLOW}Otros puertos que usa este repo:${NC}"
  echo "  8734  el dev de siempre (persistente — no lo mates por costumbre)"
  echo "  8736  servidor FRESCO para las seis smokes que importan fuentes"
  echo "  8799  vite preview, para tools/smoke.mjs contra el build"
else
  echo -e "${RED}No arrancó. Últimas líneas de $LOG:${NC}"
  tail -20 "$LOG"
  exit 1
fi
