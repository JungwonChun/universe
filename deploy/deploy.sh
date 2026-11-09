#!/usr/bin/env bash
# Self-hosted Runner에서 실행: Docker Hub 이미지를 받아 blue/green 방식으로 무중단 교체한다.
#   사용법: deploy.sh <이미지:태그> <기대 버전>
# 고정 진입점 universe-proxy(127.0.0.1:8090)가 활성 컨테이너로 요청을 넘기고,
# 새 컨테이너가 healthy가 되면 proxy 설정만 바꿔 reload한 뒤 이전 컨테이너를 내린다.
set -euo pipefail

IMAGE="$1"
VERSION="$2"
STATE_DIR="${UNIVERSE_DEPLOY_DIR:-$HOME/universe-deploy}"
PORT="${UNIVERSE_PORT:-8090}"
NET=universe-net
PROXY=universe-proxy
HERE="$(cd "$(dirname "$0")" && pwd)"
ts() { date -u '+%H:%M:%S'; }

mkdir -p "$STATE_DIR"
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

old=$(grep -oE 'universe-(blue|green)' "$STATE_DIR/active.conf" 2>/dev/null || true)
if [ "$old" = universe-blue ]; then new=universe-green; else new=universe-blue; fi
echo "[$(ts)] 활성: ${old:-없음} → 새 컨테이너: $new"

echo "[$(ts)] 1) docker pull $IMAGE"
[ "${SKIP_PULL:-0}" = 1 ] || docker pull -q "$IMAGE"   # SKIP_PULL=1: 로컬 이미지로 시험할 때

echo "[$(ts)] 2) $new 실행 (기존 서비스는 그대로 응답 중)"
docker rm -f "$new" >/dev/null 2>&1 || true
docker run -d --name "$new" --network "$NET" --restart unless-stopped \
  --label universe.version="$VERSION" "$IMAGE" >/dev/null

echo "[$(ts)] 3) healthcheck 대기"
status=starting
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$new")
  [ "$status" = healthy ] && break
  sleep 1
done
if [ "$status" != healthy ]; then
  echo "새 컨테이너가 healthy가 되지 않음 → 롤백(기존 컨테이너 유지)"
  docker logs --tail 50 "$new" || true
  docker rm -f "$new" >/dev/null
  exit 1
fi
got=$(docker exec "$new" wget -qO- http://127.0.0.1/version.json)
echo "[$(ts)]    $new 응답: $got"
case "$got" in *"\"$VERSION\""*) ;; *) echo "버전 불일치(기대 $VERSION) → 롤백"; docker rm -f "$new" >/dev/null; exit 1;; esac

echo "[$(ts)] 4) proxy 전환: universe_app → $new"
cp "$HERE/proxy.conf" "$STATE_DIR/proxy.conf"
printf 'upstream universe_app { server %s:80; }\n' "$new" > "$STATE_DIR/active.conf"
if [ -n "$(docker ps -q -f name=^${PROXY}$)" ]; then
  docker exec "$PROXY" nginx -t -q
  docker exec "$PROXY" nginx -s reload          # 기존 연결은 끝까지 처리하는 graceful reload
else
  docker rm -f "$PROXY" >/dev/null 2>&1 || true
  docker run -d --name "$PROXY" --network "$NET" --restart unless-stopped \
    -p "127.0.0.1:$PORT:80" \
    -v "$STATE_DIR/proxy.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$STATE_DIR:/etc/nginx/universe:ro" \
    nginx:1.27-alpine >/dev/null
fi

echo "[$(ts)] 5) 진입점 확인"
for _ in $(seq 1 20); do
  got=$(curl -fs "http://127.0.0.1:$PORT/version.json" || true)
  case "$got" in *"\"$VERSION\""*) break;; esac
  sleep 0.5
done
echo "[$(ts)]    http://127.0.0.1:$PORT/version.json → $got"
case "$got" in *"\"$VERSION\""*) ;; *) echo "진입점이 새 버전을 반환하지 않음"; exit 1;; esac

if [ -n "$old" ] && [ "$old" != "$new" ]; then
  echo "[$(ts)] 6) 이전 컨테이너 $old 종료 (진행 중 요청 처리 후)"
  sleep 3
  docker stop -t 10 "$old" >/dev/null 2>&1 || true
  docker rm "$old" >/dev/null 2>&1 || true
fi
echo "[$(ts)] 배포 완료: $IMAGE ($VERSION)"
