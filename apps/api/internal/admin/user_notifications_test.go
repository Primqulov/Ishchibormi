package admin

import (
	"context"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Admin qo'lda yozgan xabar ham, hammaga ketgan broadcast ham bir xil
// `type: "system"` bilan saqlanadi. Foydalanuvchi kartasida faqat
// BIRINCHISI ko'rinishi kerak — aks holda "men bu odamga nima yozganman?"
// degan savolga hamma olgan e'lonlar ham javob bo'lib tushardi.
func TestAdminNotificationsExcludeBroadcasts(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()

	h := &Handler{
		Notify: notification.New(db),
		Admins: db.Collection("admins"),
	}

	adminID := primitive.NewObjectID()
	otherAdmin := primitive.NewObjectID()
	userID := primitive.NewObjectID()
	otherUser := primitive.NewObjectID()

	if _, err := db.Collection("admins").InsertMany(ctx, []any{
		bson.M{"_id": adminID, "username": "diyor"},
		bson.M{"_id": otherAdmin, "username": "nodira"},
	}); err != nil {
		t.Fatalf("admins seed: %v", err)
	}

	now := time.Now()
	if _, err := db.Collection("notifications").InsertMany(ctx, []any{
		// Qo'lda yuborilgan — ro'yxatda bo'lishi kerak.
		bson.M{"userId": userID, "type": "system", "title": "Eski xabar",
			"body": "b1", "isRead": true, "createdAt": now.Add(-2 * time.Hour),
			"sentByAdminId": adminID},
		bson.M{"userId": userID, "type": "system", "title": "Yangi xabar",
			"body": "b2", "isRead": false, "createdAt": now,
			"sentByAdminId": otherAdmin},
		// Broadcast: sentByAdminId YO'Q — tushmasligi kerak.
		bson.M{"userId": userID, "type": "system", "title": "Broadcast",
			"body": "hammaga", "isRead": false, "createdAt": now},
		// Tizim xabari — tushmasligi kerak.
		bson.M{"userId": userID, "type": "application", "title": "Ariza qabul qilindi",
			"body": "", "isRead": false, "createdAt": now},
		// Boshqa foydalanuvchiga yozilgan — tushmasligi kerak.
		bson.M{"userId": otherUser, "type": "system", "title": "Boshqaga",
			"body": "", "isRead": false, "createdAt": now, "sentByAdminId": adminID},
	}); err != nil {
		t.Fatalf("notifications seed: %v", err)
	}

	got := h.adminNotificationsFor(ctx, userID)

	if len(got) != 2 {
		titles := []string{}
		for _, g := range got {
			titles = append(titles, g.Title)
		}
		t.Fatalf("%d ta qaytdi %v, 2 kutilgan", len(got), titles)
	}

	// Yangisidan boshlab tartiblanadi.
	if got[0].Title != "Yangi xabar" || got[1].Title != "Eski xabar" {
		t.Errorf("tartib noto'g'ri: %s, %s", got[0].Title, got[1].Title)
	}

	// Yuborgan adminning NOMI qaytadi — faqat id emas, aks holda panel
	// "kim yozgan?" degan savolga javob bera olmasdi.
	if got[0].SentBy != "nodira" {
		t.Errorf("got[0].SentBy = %q, 'nodira' kutilgan", got[0].SentBy)
	}
	if got[1].SentBy != "diyor" {
		t.Errorf("got[1].SentBy = %q, 'diyor' kutilgan", got[1].SentBy)
	}

	// O'qilgan holati ham keladi — admin xabari yetib borganini bilishi kerak.
	if !got[1].IsRead || got[0].IsRead {
		t.Errorf("isRead noto'g'ri: yangi=%v eski=%v", got[0].IsRead, got[1].IsRead)
	}
	if got[0].Body != "b2" {
		t.Errorf("body yo'qolgan: %q", got[0].Body)
	}
}

// Hech qanday xabar yozilmagan foydalanuvchida bo'sh (lekin nil EMAS)
// ro'yxat qaytishi kerak: nil JSON'da `null` bo'lib chiqadi va ikkala
// klient ham uni ro'yxat sifatida o'qiy olmasdi.
func TestAdminNotificationsEmptyIsNotNil(t *testing.T) {
	db := filterDB(t)
	h := &Handler{Notify: notification.New(db), Admins: db.Collection("admins")}

	got := h.adminNotificationsFor(context.Background(), primitive.NewObjectID())
	if got == nil {
		t.Fatal("nil qaytdi, bo'sh ro'yxat kutilgan")
	}
	if len(got) != 0 {
		t.Fatalf("%d ta qaytdi, 0 kutilgan", len(got))
	}
}

// PushFromAdmin yozuvda adminni qoldirishi shart — aks holda xabar
// broadcast'dan farq qilmay qolardi.
func TestPushFromAdminRecordsSender(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	svc := notification.New(db)

	userID := primitive.NewObjectID()
	adminID := primitive.NewObjectID()
	svc.PushFromAdmin(ctx, userID, adminID, "Salom", "matn")
	// Oddiy Push esa qoldirmasligi kerak.
	svc.Push(ctx, userID, "system", "Broadcast", "hammaga", nil)

	cur, err := svc.Col.Find(ctx, bson.M{"userId": userID})
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	defer cur.Close(ctx)

	seen := map[string]primitive.ObjectID{}
	for cur.Next(ctx) {
		var n models.Notification
		if cur.Decode(&n) == nil {
			seen[n.Title] = n.SentByAdminID
		}
	}
	if seen["Salom"] != adminID {
		t.Errorf("PushFromAdmin adminni yozmadi: %v", seen["Salom"])
	}
	if !seen["Broadcast"].IsZero() {
		t.Errorf("Push admin yozib qo'ydi: %v", seen["Broadcast"])
	}
}
