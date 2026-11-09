# ---- 1단계: React/Vite 앱 빌드 ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Vite는 빌드 시점에 환경 변수를 번들에 넣으므로 빌드 인자로 받는다 (GitHub Secrets에서 전달)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG APP_VERSION=dev
ARG BUILD_TIME=unknown
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_APP_VERSION=$APP_VERSION \
    VITE_BUILD_TIME=$BUILD_TIME
RUN npm run build \
 && printf '{"version":"%s","built":"%s"}\n' "$APP_VERSION" "$BUILD_TIME" > dist/version.json

# ---- 2단계: nginx로 정적 파일 서빙 ----
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=2s --timeout=2s --retries=15 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
