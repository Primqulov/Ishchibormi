FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# VITE_* o'zgaruvchilari build vaqtida bundle ichiga yoziladi (runtime'da emas),
# shuning uchun ular ARG sifatida keladi va compose'dan uzatiladi.
ARG VITE_API_BASE
ARG VITE_AUTH_BOT_USERNAME
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_AUTH_BOT_USERNAME=$VITE_AUTH_BOT_USERNAME
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
