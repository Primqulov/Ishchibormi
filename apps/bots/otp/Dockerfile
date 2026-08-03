FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
# Reproducible deps from committed go.mod + go.sum (no `go mod tidy` at build).
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/bot ./cmd/bot

FROM alpine:3.19
RUN apk add --no-cache ca-certificates \
 && adduser -D -u 10001 appuser
WORKDIR /app
COPY --from=build /out/bot /app/bot
USER appuser
ENTRYPOINT ["/app/bot"]
