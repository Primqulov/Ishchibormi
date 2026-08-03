FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
# Reproducible deps: use the committed go.mod + go.sum. No `go mod tidy` at build
# (that mutates deps and needs network) — CI keeps go.mod/go.sum in sync.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/seed ./seed
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/resetadmin ./cmd/resetadmin
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/reviewaccount ./cmd/reviewaccount

FROM alpine:3.19
# Run as a non-root user. The data dirs are pre-created and chowned so the named
# docker volumes (avatars, uploads) inherit appuser ownership on first mount and
# stay writable without root.
RUN apk add --no-cache ca-certificates \
 && adduser -D -u 10001 appuser \
 && mkdir -p /data/avatars /app/data/uploads \
 && chown -R appuser:appuser /data /app
WORKDIR /app
COPY --from=build /out/api /app/api
COPY --from=build /out/seed /app/seed
COPY --from=build /out/resetadmin /app/resetadmin
COPY --from=build /out/reviewaccount /app/reviewaccount
USER appuser
EXPOSE 8080
ENTRYPOINT ["/app/api"]
