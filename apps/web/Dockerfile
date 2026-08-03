FROM node:20-alpine AS deps
WORKDIR /app
# Reproducible install from the committed lockfile (same as CI's `npm ci`).
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* qiymatlari `npm run build` paytida kodga "baked" bo'ladi, shuning
# uchun ularni ALBATTA build vaqtida (ARG orqali) berish kerak — runtime env kech.
# Berilmasa lib/api.ts localhost'ga tushib qoladi va productionda API ishlamaydi.
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_WS_BASE
ARG NEXT_PUBLIC_BOT_USERNAME
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_WS_BASE=$NEXT_PUBLIC_WS_BASE
ENV NEXT_PUBLIC_BOT_USERNAME=$NEXT_PUBLIC_BOT_USERNAME
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# Run as the built-in non-root `node` user. --chown keeps the standalone server's
# files (incl. .next/cache for ISR) writable without root.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
