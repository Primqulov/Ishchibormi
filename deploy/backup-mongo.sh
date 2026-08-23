#!/usr/bin/env bash
# Konteynerdagi MongoDB'ning kunlik zaxira nusxasi (gzip arxiv).
#
# Serverda baza konteyner ichida (`mongo_data` volume) turadi — ya'ni server
# o'chsa yoki volume yo'qolsa ma'lumot ham ketadi. Bu skript har kuni arxiv
# yaratadi va eskilarini tozalaydi. server-setup.sh uni /etc/cron.d ga yozadi.
#
# Qo'lda ishga tushirish:
#   PROJECT_DIR=/opt/ishchibormi deploy/backup-mongo.sh
#
# Tiklash (DIQQAT: mavjud ma'lumot ustiga yozadi):
#   gunzip -c /var/backups/ishchibormi/mongo-20260820-0330.gz \
#     | docker compose exec -T mongo mongorestore --archive --gzip --drop
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/ishchibormi}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ishchibormi}"
KEEP_DAYS="${KEEP_DAYS:-7}"
MONGO_DB="${MONGO_DB:-ishchibormi}"

cd "$PROJECT_DIR"

# MONGO_URI tashqi klasterga (masalan Atlas) qarab tursa, konteyner Mongo'si
# bo'sh bo'ladi va bu zaxira MA'NOSIZ. Shu holatni jimgina o'tkazib yubormaymiz.
if [ -f .env ] && grep -qE '^MONGO_URI=mongodb\+srv://' .env; then
	echo "[backup] MONGO_URI tashqi klasterga qaragan — konteyner zaxirasi o'tkazib yuborildi."
	echo "[backup] Tashqi baza zaxirasini provayder panelidan sozlang (Atlas: Backup)."
	exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$BACKUP_DIR/mongo-$STAMP.gz"

echo "[backup] $(date -Is) — $MONGO_DB -> $OUT"
# --archive stdout'ga yozadi; `exec -T` TTY ajratmaydi, aks holda arxiv buziladi.
docker compose exec -T mongo mongodump --db "$MONGO_DB" --archive --gzip >"$OUT"

# Bo'sh/yarim yozilgan fayl "zaxira bor" degan yolg'on tuyg'u bermasin.
if [ ! -s "$OUT" ]; then
	echo "[backup] XATO: arxiv bo'sh — o'chirildi." >&2
	rm -f "$OUT"
	exit 1
fi

echo "[backup] Tayyor: $(du -h "$OUT" | cut -f1)"
find "$BACKUP_DIR" -name 'mongo-*.gz' -mtime "+$KEEP_DAYS" -delete
echo "[backup] $KEEP_DAYS kundan eski arxivlar tozalandi."
