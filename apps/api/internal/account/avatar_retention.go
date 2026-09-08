package account

import (
	"context"
	"errors"
	"strings"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
)

// Avatar uploads now have their own metadata/tombstones. Permanent account
// erasure must remove those records and any older file awaiting moderation
// cleanup before deleting the user that makes the pending work discoverable.
func (p *Purger) purgeAvatarUploads(ctx context.Context, u models.User) error {
	urls := map[string]bool{}
	for _, job := range u.AvatarDeletionJobs {
		if !job.AuditDone {
			return errors.New("avatar audit is pending; retry account erasure after recovery")
		}
		urls[job.URL] = true
	}
	col := p.users.Database().Collection("avatar_uploads")
	cur, err := col.Find(ctx, bson.M{"userId": u.ID})
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var record models.AvatarUpload
		if err := cur.Decode(&record); err != nil {
			return err
		}
		urls[record.ID] = true
	}
	if err := cur.Err(); err != nil {
		return err
	}
	if len(urls) > 0 && p.storage == nil {
		return errors.New("avatar storage is unavailable")
	}
	for url := range urls {
		key := p.storage.KeyFromURL(url)
		if strings.HasPrefix(key, "avatars/"+u.ID.Hex()+"/") && p.storage.KeyBelongsToUser(key, u.ID.Hex()) {
			if err := p.storage.Delete(ctx, key); err != nil {
				return err
			}
		}
	}
	_, err = col.DeleteMany(ctx, bson.M{"userId": u.ID})
	return err
}
