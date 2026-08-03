// Package tgsend is a minimal Telegram Bot API client for pushing messages to a
// user's chat from the API process.
//
// The auth bot (cmd/bot) owns the long-polling connection — only one process may
// poll a token at a time — but sending is a plain stateless HTTP call, so the API
// can use the same token to push a message without disturbing the bot.
package tgsend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ErrUnreachable means the message could not be delivered to the user's chat:
// no token configured, no known chat id, the user never pressed /start, or they
// blocked the bot. Callers surface this as "open the bot and press start".
var ErrUnreachable = errors.New("telegram chat unreachable")

type Client struct {
	token string
	http  *http.Client
}

func New(token string) *Client {
	return &Client{token: token, http: &http.Client{Timeout: 10 * time.Second}}
}

// Configured reports whether a bot token is available at all.
func (c *Client) Configured() bool { return c != nil && c.token != "" }

type sendReq struct {
	ChatID    int64  `json:"chat_id"`
	Text      string `json:"text"`
	ParseMode string `json:"parse_mode,omitempty"`
}

type sendResp struct {
	OK          bool   `json:"ok"`
	ErrorCode   int    `json:"error_code"`
	Description string `json:"description"`
}

// SendHTML delivers an HTML-formatted message to chatID. Text must already be
// escaped with [EscapeHTML] everywhere it embeds untrusted or symbol-bearing
// content. Any failure — transport, non-2xx, or ok:false — is reported as
// [ErrUnreachable] so callers have a single "fall back to the bot link" branch.
func (c *Client) SendHTML(ctx context.Context, chatID int64, html string) error {
	if !c.Configured() || chatID == 0 {
		return ErrUnreachable
	}
	body, err := json.Marshal(sendReq{ChatID: chatID, Text: html, ParseMode: "HTML"})
	if err != nil {
		return err
	}
	url := "https://api.telegram.org/bot" + c.token + "/sendMessage"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	defer func() { _ = res.Body.Close() }()

	var out sendResp
	// A malformed body on a 2xx is still a delivery we can't confirm, so decode
	// errors fall through to the !out.OK branch below.
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != http.StatusOK || !out.OK {
		return fmt.Errorf("%w: telegram %d %s", ErrUnreachable, out.ErrorCode, out.Description)
	}
	return nil
}

// EscapeHTML escapes the three characters Telegram's HTML parse mode treats as
// markup. Deletion codes contain punctuation, so every interpolated value must
// go through this or the message is rejected with "can't parse entities".
func EscapeHTML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}
