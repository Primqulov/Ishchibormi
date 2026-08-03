// Package push mobil ilovaga FCM (Firebase Cloud Messaging) orqali push
// yuboradi va qurilma tokenlarini boshqaradi.
//
// Firebase admin SDK ataylab ishlatilmagan: u katta dependency daraxtini olib
// keladi. Bizga kerak bo'lgani ikki HTTP chaqiruv — service-account JWT bilan
// OAuth access-token olish va FCM HTTP v1 messages:send. Ikkalasi ham mavjud
// golang-jwt (RS256) va stdlib bilan yoziladi.
package push

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

const fcmScope = "https://www.googleapis.com/auth/firebase.messaging"

// serviceAccount — Firebase konsolidan yuklab olinadigan service-account JSON
// faylining bizga kerak maydonlari.
type serviceAccount struct {
	ProjectID   string `json:"project_id"`
	PrivateKey  string `json:"private_key"`
	ClientEmail string `json:"client_email"`
	TokenURI    string `json:"token_uri"`
}

func parseServiceAccount(raw []byte) (serviceAccount, *rsa.PrivateKey, error) {
	var sa serviceAccount
	if err := json.Unmarshal(raw, &sa); err != nil {
		return sa, nil, fmt.Errorf("service account json: %w", err)
	}
	if sa.ProjectID == "" || sa.PrivateKey == "" || sa.ClientEmail == "" {
		return sa, nil, errors.New("service account json: project_id/private_key/client_email kerak")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}
	key, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(sa.PrivateKey))
	if err != nil {
		return sa, nil, fmt.Errorf("service account private key: %w", err)
	}
	return sa, key, nil
}

// FCM notification.Pusher interfeysini amalga oshiradi: har bir in-app
// notification yaratilganda foydalanuvchining barcha qurilmalariga push ketadi.
type FCM struct {
	Tokens *mongo.Collection

	projectID   string
	clientEmail string
	tokenURI    string
	key         *rsa.PrivateKey

	httpc *http.Client
	log   *slog.Logger

	// OAuth access-token keshi (bir soatlik token, muddati tugashiga 5 daqiqa
	// qolganda yangilanadi).
	mu          sync.Mutex
	accessToken string
	tokenExp    time.Time

	// sendURL testda soxta serverga yo'naltirish uchun; bo'sh bo'lsa haqiqiy
	// FCM endpoint ishlatiladi.
	sendURL string
}

func NewFCM(credentialsFile string, db *mongo.Database, log *slog.Logger) (*FCM, error) {
	raw, err := os.ReadFile(credentialsFile)
	if err != nil {
		return nil, err
	}
	sa, key, err := parseServiceAccount(raw)
	if err != nil {
		return nil, err
	}
	return &FCM{
		Tokens:      db.Collection("device_tokens"),
		projectID:   sa.ProjectID,
		clientEmail: sa.ClientEmail,
		tokenURI:    sa.TokenURI,
		key:         key,
		httpc:       &http.Client{Timeout: 15 * time.Second},
		log:         log,
	}, nil
}

func (f *FCM) ProjectID() string { return f.projectID }

// PushUser notification.Pusher'ni bajaradi. Request-javob yo'lini sekinlashtirmaslik
// uchun yuborish alohida goroutine'da, o'z konteksti bilan ketadi (chaqiruvchi
// request konteksti javob qaytishi bilan bekor bo'ladi).
func (f *FCM) PushUser(userID primitive.ObjectID, kind string, payload any) {
	if kind != "notification" {
		return
	}
	n, ok := payload.(models.Notification)
	if !ok {
		return
	}
	go f.deliver(userID, n)
}

func (f *FCM) deliver(userID primitive.ObjectID, n models.Notification) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cur, err := f.Tokens.Find(ctx, bson.M{"userId": userID})
	if err != nil {
		f.log.Warn("fcm: token query failed", "err", err)
		return
	}
	var tokens []string
	for cur.Next(ctx) {
		var dt models.DeviceToken
		if err := cur.Decode(&dt); err == nil && dt.Token != "" {
			tokens = append(tokens, dt.Token)
		}
	}
	cur.Close(ctx)
	if len(tokens) == 0 {
		return
	}

	for _, t := range tokens {
		status, body, err := f.send(ctx, t, n)
		if err != nil {
			f.log.Warn("fcm: send failed", "err", err)
			continue
		}
		if status >= 200 && status < 300 {
			continue
		}
		if shouldDropToken(status, body) {
			// Qurilma ilovani o'chirgan yoki token eskirgan — qayta urinib
			// o'tirmaymiz, tokenni bazadan olib tashlaymiz.
			_, _ = f.Tokens.DeleteOne(ctx, bson.M{"token": t})
			continue
		}
		f.log.Warn("fcm: send rejected", "status", status, "body", truncate(string(body), 300))
	}
}

func (f *FCM) send(ctx context.Context, token string, n models.Notification) (int, []byte, error) {
	at, err := f.getAccessToken(ctx)
	if err != nil {
		return 0, nil, err
	}
	msg, err := json.Marshal(buildMessage(token, n))
	if err != nil {
		return 0, nil, err
	}
	u := f.sendURL
	if u == "" {
		u = "https://fcm.googleapis.com/v1/projects/" + f.projectID + "/messages:send"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(msg))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+at)
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.httpc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return resp.StatusCode, body, nil
}

// buildMessage FCM HTTP v1 xabar tanasini quradi. data qiymatlari FCM talabiga
// ko'ra faqat string bo'lishi shart; ilova shu data orqali bosilganda kerakli
// sahifani ochadi.
func buildMessage(token string, n models.Notification) map[string]any {
	data := map[string]string{
		"type":           n.Type,
		"notificationId": n.ID.Hex(),
	}
	if n.RelatedEntity != nil {
		data["relatedType"] = n.RelatedEntity.Type
		data["relatedId"] = n.RelatedEntity.ID.Hex()
	}
	return map[string]any{
		"message": map[string]any{
			"token":        token,
			"notification": map[string]string{"title": n.Title, "body": n.Body},
			"data":         data,
			"android": map[string]any{
				"priority": "HIGH",
				"notification": map[string]any{
					// MainActivity shu kanalni boot'da yaratadi (flutter-app,
					// MainActivity.kt) — nomi mos kelmasa Android standart
					// "Miscellaneous" kanaliga tushib qoladi.
					"channel_id":    "ishchibormi_default",
					"default_sound": true,
				},
			},
		},
	}
}

// shouldDropToken FCM javobiga qarab token endi yaroqsizligini aytadi.
// 404/NOT_FOUND — token ro'yxatdan chiqqan (ilova o'chirilgan), UNREGISTERED
// errorCode ham shu; 400 + INVALID_ARGUMENT token formati buzuqligini bildiradi.
func shouldDropToken(status int, body []byte) bool {
	if status == http.StatusNotFound {
		return true
	}
	s := string(body)
	if strings.Contains(s, "UNREGISTERED") {
		return true
	}
	return status == http.StatusBadRequest && strings.Contains(s, "INVALID_ARGUMENT") &&
		strings.Contains(s, "token")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// getAccessToken service-account JWT (RS256 assertion) evaziga OAuth
// access-token oladi va keshda saqlaydi.
func (f *FCM) getAccessToken(ctx context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.accessToken != "" && time.Until(f.tokenExp) > 5*time.Minute {
		return f.accessToken, nil
	}

	now := time.Now()
	claims := jwt.MapClaims{
		"iss":   f.clientEmail,
		"scope": fcmScope,
		"aud":   f.tokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
	assertion, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(f.key)
	if err != nil {
		return "", fmt.Errorf("sign assertion: %w", err)
	}

	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {assertion},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := f.httpc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oauth token: status %d: %s", resp.StatusCode, truncate(string(body), 300))
	}
	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tr); err != nil || tr.AccessToken == "" {
		return "", errors.New("oauth token: javobni o'qib bo'lmadi")
	}
	f.accessToken = tr.AccessToken
	f.tokenExp = now.Add(time.Duration(tr.ExpiresIn) * time.Second)
	return f.accessToken, nil
}
