.PHONY: up dev miniapp down logs seed lint test api-run web-run bot-run miniapp-run miniapp-bot-run

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

# Dev + Telegram Mini App (webapp :5173 va uning boti). Mini App compose
# profile ortida — `make dev` uni ko'tarmaydi, chunki u hali prod'ga
# chiqarilmagan (docker-compose.yml dagi izohga qarang).
miniapp:
	$(COMPOSE_DEV) --profile miniapp up --build -d

down:
	docker compose --profile miniapp down

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

miniapp-run:
	cd apps/miniapp && npm run dev

miniapp-bot-run:
	cd apps/bots/miniapp && go run ./cmd/bot

lint:
	cd apps/api && go vet ./... && (command -v golangci-lint && golangci-lint run ./... || true)
	cd apps/bots/otp && go vet ./...
	cd apps/bots/miniapp && go vet ./...
	cd apps/web && npm run lint || true

test:
	cd apps/api && go test ./...
	cd apps/bots/otp && go test ./...
	cd apps/bots/miniapp && go test ./...
