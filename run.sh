#!/usr/bin/env bash
# ============================================================================
#  Formlympic Docker 빌드 & 실행 스크립트
#  - 이미지를 빌드하고, 기존 컨테이너가 있으면 정리한 뒤 3000 포트로 띄운다.
#
#  사용법:
#    ./run.sh            # 빌드 후 백그라운드 실행
#    PORT=8080 ./run.sh  # 호스트 포트 변경 (컨테이너 내부는 항상 3000)
# ============================================================================
set -eu
# pipefail 은 bash/zsh 등 일부 셸에서만 지원됨(dash 미지원).
# `sh run.sh` 처럼 dash 로 실행돼도 죽지 않도록, 지원될 때만 활성화한다.
(set -o pipefail) 2>/dev/null && set -o pipefail || true

# ---- 설정 (필요 시 환경변수로 덮어쓰기) ----
IMAGE_NAME="${IMAGE_NAME:-formlympic}"
CONTAINER_NAME="${CONTAINER_NAME:-formlympic}"
PORT="${PORT:-3000}"

# 스크립트 위치로 이동 (어디서 실행해도 동작)
cd "$(dirname "$0")"

echo "▶ Docker 이미지 빌드: ${IMAGE_NAME}"
docker build -t "${IMAGE_NAME}" .

# 동일 이름 컨테이너가 떠 있으면 제거 후 재실행
if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "▶ 기존 컨테이너 제거: ${CONTAINER_NAME}"
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

echo "▶ 컨테이너 실행: ${CONTAINER_NAME} (호스트 ${PORT} → 컨테이너 3000)"
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:3000" \
  --restart unless-stopped \
  "${IMAGE_NAME}"

echo ""
echo "✅ 실행 완료"
echo "   - 서버형 UI       : http://localhost:${PORT}/"
echo "   - 프론트 전용 UI  : http://localhost:${PORT}/standalone.html"
echo "   - 로그 보기        : docker logs -f ${CONTAINER_NAME}"
echo "   - 중지/제거        : docker rm -f ${CONTAINER_NAME}"
