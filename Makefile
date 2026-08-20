.PHONY: up dev down logs seed lint test api-run web-run bot-run

# DIQQAT: barcha compose chaqiruvlari repo ILDIZIDAN va prod compose birinchi
# -f bo'lib turishi kerak — aks holda loyiha nomi o'zgarib, volume'lar
# (uploads/avatars) yangi va bo'sh bo'lib qoladi. Sabab: deploy/README.md
COMPOSE_DEV = docker compose -f docker-compose.yml -f deploy/docker-compose.dev.yml

up:
	docker compose up --build -d

# Lokal dev rejim (APP_ENV=dev, OTP_DEV_RETURN=true, localhost CORS).
# Prod compose fayli ataylab production literallariga mixlangan — dev faqat
# shu overlay orqali yoqiladi (deploy/docker-compose.dev.yml dagi izohga qarang).
dev:
	$(COMPOSE_DEV) up --build -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

seed:
	cd apps/api && go run ./seed

api-run:
	cd apps/api && go run ./cmd/api

web-run:
	cd apps/web && npm run dev

bot-run:
	cd apps/bots/otp && go run ./cmd/bot

lint:
	cd apps/api && go vet ./... && (command -v golangci-lint && golangci-lint run ./... || true)
	cd apps/bots/otp && go vet ./...
	cd apps/web && npm run lint || true

test:
	cd apps/api && go test ./...
	cd apps/bots/otp && go test ./...
