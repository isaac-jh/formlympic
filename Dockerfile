# ============================================================================
#  Formlympic 배포용 이미지
#  - Express 서버(src/server.ts)를 tsx 런타임으로 실행하여 3000 포트에서 서빙.
#  - public/index.html(서버형) + public/standalone.html(프론트 전용) 모두 제공.
# ============================================================================
FROM node:20-alpine

WORKDIR /app

# 1) 의존성 먼저 설치 (레이어 캐시 활용)
#    tsx 가 devDependencies 에 있으므로 dev 포함 설치한다.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# 2) 애플리케이션 소스 복사
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# 3) 런타임 설정
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 4) 헬스체크: 정적 진입점 응답 확인
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

# 5) 서버 실행 (npm start = tsx src/server.ts, 3000 포트 바인딩)
CMD ["npm", "start"]
