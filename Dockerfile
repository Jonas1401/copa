# CopaLinks — imagem do aplicativo (Next.js + PostgreSQL)
# Subir: docker compose up -d --build   (veja DEPLOY.md)

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Chromium + fontes: leitura do painel da APPA pelo navegador automático e pelo
# OCR (métodos 3 e 4 do fallback). O app o encontra sozinho em /usr/bin/chromium.
# Para uma imagem menor, sem esses dois métodos:  --build-arg INSTALAR_CHROMIUM=0
ARG INSTALAR_CHROMIUM=1
RUN if [ "$INSTALAR_CHROMIUM" = "1" ]; then \
      apk add --no-cache chromium nss freetype harfbuzz ca-certificates font-noto ttf-freefont; \
    fi
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "run", "start"]
