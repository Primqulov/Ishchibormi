package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/account"
	"github.com/ishchibormi/backend/internal/admin"
	"github.com/ishchibormi/backend/internal/application"
	"github.com/ishchibormi/backend/internal/auth"
	"github.com/ishchibormi/backend/internal/category"
	"github.com/ishchibormi/backend/internal/elon"
	"github.com/ishchibormi/backend/internal/feedback"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/internal/push"
	"github.com/ishchibormi/backend/internal/report"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/internal/user"
	"github.com/ishchibormi/backend/pkg/db"
	"github.com/ishchibormi/backend/pkg/envfile"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/logger"
	"github.com/ishchibormi/backend/pkg/storage"
)

func main() {
	envfile.Load()
	log := logger.New()
	cfg := config.Load()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mdb, err := db.Connect(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Error("mongo connect failed", "err", err)
		os.Exit(1)
	}
	if err := db.EnsureIndexes(ctx, mdb); err != nil {
		log.Warn("ensure indexes", "err", err)
	}
	// Bir martalik, versiyalangan migratsiyalar (schema_migrations' da qayd
	// etiladi — har biri faqat bir marta ishlaydi, shuning uchun ma'lumot
	// o'sgani sayin boot sekinlashmaydi). Yuqoridagi EnsureIndexes va quyidagi
	// EnsureDefaults ataylab har boot'da ishlaydi (idempotent / biznes
	// moslashtiruvi) va bu registrga kirmaydi.
	if err := db.RunMigrations(ctx, mdb); err != nil {
		log.Warn("run migrations", "err", err)
	}
	// Boshlang'ich tizim turkumlarini upsert qilamiz. Admin yaratgan turkumlar
	// deploy/restart paytida o'zgartirilmaydi.
	if err := category.EnsureDefaults(ctx, mdb); err != nil {
		log.Warn("ensure categories", "err", err)
	}

	// services
	notif := notification.New(mdb)

	// Mobil push (FCM). Credentials berilmasa jimgina o'chiq — API to'liq
	// ishlayveradi, bildirishnomalar faqat in-app (polling) bo'lib qoladi.
	// Ulanish nuqtasi: notification.Service.Push ichidagi Pusher chaqiruvi —
	// har bir in-app notification (ariza, qabul, rad, broadcast) shu yerdan
	// o'tadi, shuning uchun alohida "push yuborish" kodi hech qayerda kerak emas.
	pushH := push.NewHandler(mdb)
	if cfg.FCMCredentialsFile != "" {
		if fcm, err := push.NewFCM(cfg.FCMCredentialsFile, mdb, log); err != nil {
			log.Warn("fcm init failed — mobile push disabled", "err", err)
		} else {
			notif.AttachPusher(fcm)
			log.Info("fcm push ready", "project", fcm.ProjectID())
		}
	} else {
		log.Info("fcm push disabled (FCM_CREDENTIALS_FILE not set)")
	}

	// S3 storage — optional. If creds aren't set, upload endpoints return 503.
	var s3svc *storage.Service
	if cfg.AWSS3Bucket != "" {
		s3svc, err = storage.New(ctx, storage.Config{
			Region: cfg.AWSRegion, AccessKeyID: cfg.AWSAccessKeyID,
			SecretAccessKey: cfg.AWSSecretAccessKey,
			Bucket:          cfg.AWSS3Bucket, PublicBaseURL: cfg.AWSS3PublicBaseURL,
		})
		if err != nil {
			log.Warn("s3 init", "err", err)
		} else {
			log.Info("s3 ready", "bucket", cfg.AWSS3Bucket, "region", cfg.AWSRegion)
		}
	} else {
		// No S3 configured — fall back to local-disk storage so uploads work
		// out of the box. Files are written under cfg.UploadDir and served by
		// this API at cfg.UploadPublicBase (see the /uploads/* route below).
		s3svc, err = storage.NewLocal(cfg.UploadDir, cfg.UploadPublicBase)
		if err != nil {
			log.Warn("local storage init failed", "err", err)
		} else {
			log.Info("local storage ready", "dir", cfg.UploadDir, "base", cfg.UploadPublicBase)
		}
	}

	authH := auth.NewHandler(cfg, mdb)
	userH := user.NewHandler(mdb, s3svc)
	accountH := account.NewHandler(cfg, mdb, s3svc)
	catH := category.NewHandler(mdb)
	elonH := elon.NewHandler(mdb, s3svc, notif)
	appH := application.NewHandler(mdb, notif)
	repH := report.NewHandler(mdb)
	fbH := feedback.NewHandler(mdb)
	uploadH := upload.NewHandler(s3svc)
	adminH := admin.NewHandler(cfg, mdb, notif, s3svc)
	// Background scheduler: delivers due scheduled broadcasts (checks every
	// minute). Stops when ctx is cancelled on shutdown.
	go adminH.RunScheduler(ctx)
	// Background scheduler: qabul qilingan ishlarni belgilangan vaqtdan 18 soat
	// o'tgach (agar ikki tomon ham bekor qilmagan bo'lsa) avtomatik yakunlab,
	// ish tarixiga (arxivga) o'tkazadi. ctx bekor qilinganda to'xtaydi.
	go appH.RunAutoCompleteScheduler(ctx)
	// Background sweeper: permanently erases accounts whose retention window
	// (ACCOUNT_RETENTION_DAYS, default 90) has closed — the second stage of
	// account deletion required by Google Play. Covers both self-service and
	// admin deletions; see internal/account/retention.go. Stops on ctx cancel.
	purger := account.NewPurger(mdb, s3svc, cfg.AccountRetentionDays, log)
	go purger.Run(ctx)
	log.Info("account retention active", "days", purger.RetentionDays())

	// Rate limiting keys off the real client IP. Only trust forwarding headers
	// when explicitly configured to sit behind a trusted proxy; otherwise XFF is
	// spoofable and defeats the limiter. TrustedProxyHops decides which element
	// of the forwarded chain is the client — see httpx.forwardedClientIP.
	httpx.TrustProxyHeaders = cfg.TrustProxyHeaders
	httpx.TrustedProxyHops = cfg.TrustedProxyHops

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	// NOTE: chi's middleware.RealIP is deliberately NOT mounted. It trusts
	// True-Client-IP / X-Real-IP / the LEFTMOST X-Forwarded-For element — all
	// three fully attacker-controlled behind an appending proxy — and it
	// overwrites r.RemoteAddr with the result, poisoning the fallback path too.
	// httpx.clientIP resolves the client itself, counting from the trusted end.
	r.Use(httpx.AccessLog)
	r.Use(httpx.Recover)
	r.Use(httpx.SecurityHeaders)
	// Auth is a Bearer token in the Authorization header (not cookies), so
	// AllowCredentials is intentionally left off — the browser never needs to
	// send cookies cross-origin here.
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: cfg.CORSOrigins,
		AllowedMethods: []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
		MaxAge:         300,
	}))

	otpLimiter := httpx.NewLimiter(10, 0.5)    // 10 burst, 1 / 2s
	applyLimiter := httpx.NewLimiter(20, 0.5)  // 20 burst, slow refill
	loginLimiter := httpx.NewLimiter(8, 0.2)   // 8 burst, 1 / 5s — throttles credential brute-force
	deleteLimiter := httpx.NewLimiter(5, 0.05) // 5 burst, 1 / 20s — account-deletion codes hit Telegram
	// Refresh legitimately fires on every 401 from the mobile interceptor, so
	// the budget is generous — this only caps offline brute-force of refresh
	// tokens and accidental client retry-loops.
	refreshLimiter := httpx.NewLimiter(30, 0.1)   // 30 burst, 1 / 10s
	uploadLimiter := httpx.NewLimiter(12, 0.1)    // 12 burst, then 1 / 10s per authenticated user
	publicReadLimiter := httpx.NewLimiter(120, 5) // generous public-query budget per client IP
	// Authenticated writes that leave permanent, publicly visible or
	// admin-facing residue. Keyed by user id, not IP: the point is to bound what
	// one account can produce, and IP is both spoofable and shared (one mobile
	// carrier NAT would otherwise throttle a whole city).
	elonLimiter := httpx.NewLimiter(10, 0.02) // 10 burst, then 1 / 50s — job posting
	// Reports and feedback fan out to a notification document PER ACTIVE ADMIN,
	// so one request is an amplified write. Tight budget on purpose.
	inboxLimiter := httpx.NewLimiter(5, 0.01) // 5 burst, then 1 / 100s
	// Device-token registration is idempotent for a real client (one token per
	// install, re-sent on rotation), so a low ceiling costs nothing legitimate
	// and stops the device_tokens collection being used as free storage.
	deviceLimiter := httpx.NewLimiter(10, 0.05) // 10 burst, then 1 / 20s

	// Evict idle per-IP buckets so the limiter maps don't grow unbounded (each
	// unique client IP would otherwise leave a permanent entry). The 15-min idle
	// threshold is far above every bucket's full-refill time (<=40s), so eviction
	// never grants a returning client extra allowance. Stops on ctx cancel.
	otpLimiter.StartCleanup(ctx, 5*time.Minute, 15*time.Minute)
	applyLimiter.StartCleanup(ctx, 5*time.Minute, 15*time.Minute)
	loginLimiter.StartCleanup(ctx, 5*time.Minute, 15*time.Minute)
	deleteLimiter.StartCleanup(ctx, 5*time.Minute, 15*time.Minute)
	refreshLimiter.StartCleanup(ctx, 5*time.Minute, 15*time.Minute)
	uploadLimiter.StartCleanup(ctx, 5*time.Minute, 15*time.Minute)
	publicReadLimiter.StartCleanup(ctx, 5*time.Minute, 15*time.Minute)
	// These three refill slowly, so their buckets need a correspondingly longer
	// idle threshold — evicting one before it has refilled would hand the owner
	// a fresh full budget and undo the limit.
	elonLimiter.StartCleanup(ctx, 15*time.Minute, 30*time.Minute)
	inboxLimiter.StartCleanup(ctx, 15*time.Minute, 30*time.Minute)
	deviceLimiter.StartCleanup(ctx, 15*time.Minute, 30*time.Minute)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { httpx.JSON(w, 200, map[string]string{"status": "ok"}) })

	// Serve locally-stored uploads (only when running without S3). Public, no
	// auth — these are image URLs embedded in elons/avatars.
	if s3svc != nil && s3svc.LocalDir() != "" {
		fs := http.StripPrefix("/uploads/", http.FileServer(http.Dir(s3svc.LocalDir())))
		serveUpload := func(w http.ResponseWriter, r *http.Request) {
			// http.FileServer generates directory listings by default. Upload URLs
			// are public, but the complete object inventory/user-id hierarchy is not.
			ext := strings.ToLower(filepath.Ext(r.URL.Path))
			if strings.HasSuffix(r.URL.Path, "/") || (ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			fs.ServeHTTP(w, r)
		}
		r.Get("/uploads/*", serveUpload)
		r.Head("/uploads/*", serveUpload)
	}

	r.Route("/api", func(r chi.Router) {
		// Public auth
		r.Group(func(r chi.Router) {
			r.Use(otpLimiter.Middleware("otp"))
			r.Post("/auth/otp/request", authH.RequestOTP)
			r.Post("/auth/otp/verify", authH.VerifyOTP)
			r.Get("/auth/otp/peek", authH.DevPeekOTP)
		})
		r.With(refreshLimiter.Middleware("refresh")).Post("/auth/refresh", authH.Refresh)

		// Public listing. OptionalUserAuth doesn't gate anything — it only lets
		// the feed recognise the Play review account, so a reviewer sees the
		// elon they just posted instead of it silently vanishing. Anonymous
		// visitors are unaffected. The review id is passed only while a window
		// is actually open.
		reviewUserID := ""
		if cfg.ReviewLoginEnabled {
			reviewUserID = cfg.ReviewLoginUserID
		}
		r.Group(func(r chi.Router) {
			r.Use(httpx.OptionalUserAuth(cfg.JWTAccessSecret, reviewUserID))
			r.With(publicReadLimiter.Middleware("public-read")).Get("/elons", elonH.Feed)
			r.With(publicReadLimiter.Middleware("public-read")).Get("/elons/{id}", elonH.Get)
		})
		r.Get("/elons/sitemap", elonH.Sitemap) // XML sitemap uchun yengil ro'yxat
		r.With(publicReadLimiter.Middleware("public-read")).Get("/users/{id}", userH.GetPublic)
		r.With(publicReadLimiter.Middleware("public-read")).Get("/users", userH.Search)
		r.Get("/categories", catH.List)

		// Auth-protected
		r.Group(func(r chi.Router) {
			r.Use(httpx.UserAuth(cfg.JWTAccessSecret))
			r.Use(auth.RequireActiveUser(authH.Users()))

			r.Get("/me", userH.Me)
			r.Patch("/me", userH.UpdateMe)

			// Mobil qurilmaning FCM push tokenini ro'yxatga olish (login'dan
			// keyin / token yangilanganda) va o'chirish (logout'da).
			r.With(deviceLimiter.MiddlewareKey("device-token", httpx.UserID)).
				Post("/users/me/device-token", pushH.Register)
			r.Delete("/users/me/device-token", pushH.Unregister)

			// Self-service account deletion, confirmed by a code pushed to the
			// user's Telegram. Rate-limited on both halves: /request pushes a
			// Telegram message (spam vector), /confirm is a guess against the
			// code (the per-code attempt counter is the hard cap, this just
			// slows a distributed grind).
			r.Group(func(r chi.Router) {
				r.Use(deleteLimiter.Middleware("acct-delete"))
				r.Use(auth.DenyReviewAccount)
				r.Post("/me/delete/request", accountH.RequestDelete)
				r.Post("/me/delete/confirm", accountH.ConfirmDelete)
			})

			r.With(auth.DenyReviewAccount).Post("/users/{id}/block", userH.Block)
			r.With(auth.DenyReviewAccount).Delete("/users/{id}/block", userH.Unblock)

			// Turkumlarni faqat tizim/admin belgilaydi — oddiy foydalanuvchi
			// yangi turkum qo'sha olmaydi (turkumlar oldindan beriladi).

			r.With(elonLimiter.MiddlewareKey("elon-create", httpx.UserID)).Post("/elons", elonH.Create)
			r.Patch("/elons/{id}", elonH.Update)
			r.Delete("/elons/{id}", elonH.Delete)
			r.Post("/elons/{id}/cancel", elonH.Cancel)
			r.Get("/my/elons", elonH.MyElons)

			r.Group(func(r chi.Router) {
				r.Use(applyLimiter.Middleware("apply"))
				r.Post("/elons/{id}/apply", appH.Apply)
			})
			r.Post("/applications/{id}/accept", appH.Accept)
			r.Post("/applications/{id}/reject", appH.Reject)
			r.Post("/applications/{id}/cancel", appH.Cancel)
			r.Post("/applications/{id}/confirm-done", appH.ConfirmDone)

			r.Get("/my/applications", appH.MyApplications)
			r.Get("/my/elons/applications", appH.MyElonsApplications)
			r.Get("/me/history", appH.History)

			r.Get("/notifications", notif.List)
			r.Post("/notifications/read-all", notif.ReadAll)
			r.Post("/notifications/read", notif.Read)

			// Shikoyat admin moderatsiya navbatiga tushadi — demo hisob real
			// odam haqida shikoyat yubora olmasligi kerak.
			r.With(auth.DenyReviewAccount,
				inboxLimiter.MiddlewareKey("report", httpx.UserID)).Post("/reports", repH.Create)

			// Taklif va shikoyatlar (support Telegram botiga uzatiladi)
			r.With(auth.DenyReviewAccount,
				inboxLimiter.MiddlewareKey("feedback", httpx.UserID)).Post("/feedback", fbH.Create)
			r.Get("/feedback", fbH.Mine)

			// Uploads — demo hisob ommaviy CDN'ga fayl yuklay olmaydi.
			r.With(auth.DenyReviewAccount,
				uploadLimiter.MiddlewareKey("upload", httpx.UserID)).Post("/uploads", uploadH.Upload)
			r.With(auth.DenyReviewAccount).Delete("/uploads", uploadH.Delete)
		})

		// Admin
		r.With(loginLimiter.Middleware("admin-login")).Post("/admin/login", adminH.Login)
		r.Route("/admin", func(r chi.Router) {
			r.Use(httpx.AdminAuth(cfg.JWTAccessSecret))
			r.Use(admin.RequireActiveAdmin(adminH.Admins))

			// Overview — read-only, any authenticated admin (incl. support).
			r.Get("/dashboard", adminH.Dashboard)
			r.Get("/stats", adminH.Stats)
			r.Get("/categories", adminH.ListCategories)

			// Current admin + own two-factor — any authenticated admin.
			r.Get("/me", adminH.Me)
			r.Post("/logout", adminH.Logout)
			r.Post("/2fa/setup", adminH.Setup2FA)
			r.Post("/2fa/enable", adminH.Enable2FA)
			r.Post("/2fa/disable", adminH.Disable2FA)

			// Moderation — superadmin + moderator.
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireRole("moderator"))
				// Audit log — superadmin + moderator only (support ko'rmaydi).
				r.Get("/audit", adminH.Audit)
				r.Get("/users", adminH.ListUsers)
				r.Get("/users/{id}", adminH.GetUser)
				r.Post("/users/{id}/block", adminH.BlockUser)
				r.Delete("/users/{id}", adminH.DeleteUser)
				r.Post("/users/{id}/verify", adminH.VerifyUser)
				r.Post("/users/{id}/notify", adminH.NotifyUser)
				r.Get("/elons", adminH.ListElons)
				r.Delete("/elons/{id}", adminH.DeleteElon)
				r.Patch("/elons/{id}/status", adminH.SetElonStatus)
				r.Get("/reports", adminH.ListReports)
				r.Patch("/reports/{id}/resolve", repH.Resolve)
				r.Get("/applications", adminH.ListApplications)
				r.Get("/export/users.csv", adminH.ExportUsers)
				r.Get("/export/elons.csv", adminH.ExportElons)
				r.Get("/export/applications.csv", adminH.ExportApplications)
			})

			// Support desk — superadmin + moderator + support.
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireRole("moderator", "support"))
				r.Get("/feedback", fbH.ListAdmin)
				r.Patch("/feedback/{id}/resolve", fbH.Resolve)
			})

			// Superadmin only — category management, staff accounts, broadcast.
			// RequireRole() with no args admits only superadmin (always-allowed).
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireRole())
				r.Post("/categories/icon", adminH.UploadCategoryIcon)
				r.Patch("/categories/{id}/active", adminH.SetCategoryActive)
				r.Post("/categories", adminH.CreateCategory)
				r.Put("/categories/{id}", adminH.UpdateCategory)
				r.Delete("/categories/{id}", adminH.DeleteCategory)
				r.Get("/admins", adminH.ListAdmins)
				r.Post("/admins", adminH.CreateAdmin)
				r.Patch("/admins/{id}", adminH.UpdateAdmin)
				r.Delete("/admins/{id}", adminH.DeleteAdmin)
				r.Post("/broadcast", adminH.Broadcast)
				r.Get("/broadcasts", adminH.ListBroadcasts)
				r.Delete("/broadcasts/{id}", adminH.CancelBroadcast)
			})
		})
	})

	// Google Play review login state. Logged on every boot so an open review
	// window is never a silent condition — if this says ACTIVE outside an
	// actual submission, someone has left the switch on and it must be closed.
	// Intentionally log-only: no HTTP endpoint reports this, because
	// advertising an open window is an invitation to start guessing the code.
	if status := authH.ReviewLoginStatus(); status == "disabled" {
		log.Info("play review login", "state", status)
	} else {
		log.Warn("play review login IS NOT DISABLED", "state", status)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}

	go func() {
		log.Info("api listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("listen", "err", err)
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Info("shutting down")
	shutdownCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
	defer c()
	_ = srv.Shutdown(shutdownCtx)
}
