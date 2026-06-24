package sqlite

import (
	"path/filepath"
	"strings"
	"testing"

	"bastion/internal/domain"
)

func TestStorePlayerLifecycle(t *testing.T) {
	store := newTestStore(t)

	player := domain.Player{
		Name:      "张三",
		Number:    18,
		Bat:       domain.HandRight,
		Throw:     domain.HandRight,
		Positions: domain.PositionPitcher | domain.PositionInfield,
	}
	if err := store.AddPlayer(player); err != nil {
		t.Fatalf("AddPlayer failed: %v", err)
	}

	got, err := store.GetPlayer("张三")
	if err != nil {
		t.Fatalf("GetPlayer failed: %v", err)
	}
	if got != player {
		t.Fatalf("unexpected player: %+v", got)
	}

	var batBits, throwBits, positionBits int
	err = store.db.QueryRow(`
SELECT bat_hands, throw_hands, positions
FROM players
WHERE name = ?
`, "张三").Scan(&batBits, &throwBits, &positionBits)
	if err != nil {
		t.Fatalf("raw player query failed: %v", err)
	}
	if batBits != int(domain.HandRight) || throwBits != int(domain.HandRight) || positionBits != int(domain.PositionPitcher|domain.PositionInfield) {
		t.Fatalf("unexpected raw bits: bat=%d throw=%d positions=%d", batBits, throwBits, positionBits)
	}

	exists, err := store.PlayerExists("张三")
	if err != nil {
		t.Fatalf("PlayerExists failed: %v", err)
	}
	if !exists {
		t.Fatal("expected player to exist")
	}
}

func TestStoreRejectsDuplicatePlayer(t *testing.T) {
	store := newTestStore(t)
	player := domain.Player{Name: "张三", Number: 18, Bat: domain.HandRight, Throw: domain.HandRight, Positions: domain.PositionPitcher}

	if err := store.AddPlayer(player); err != nil {
		t.Fatalf("first AddPlayer failed: %v", err)
	}
	err := store.AddPlayer(player)
	if err == nil {
		t.Fatal("expected duplicate player to fail")
	}
	if !strings.Contains(err.Error(), "player already exists: 张三") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestStoreReportLifecycleAndOverwrite(t *testing.T) {
	store := newTestStore(t)
	player := domain.Player{Name: "张三", Number: 18, Bat: domain.HandRight, Throw: domain.HandRight, Positions: domain.PositionPitcher}
	if err := store.AddPlayer(player); err != nil {
		t.Fatalf("AddPlayer failed: %v", err)
	}

	first := domain.Report{Name: "张三", Date: "2026-06-24", Content: "挥棒训练", Reflection: "节奏更稳定"}
	if err := store.UpsertReport(first); err != nil {
		t.Fatalf("first UpsertReport failed: %v", err)
	}

	second := domain.Report{Name: "张三", Date: "2026-06-24", Content: "守备训练", Reflection: "脚步更主动"}
	if err := store.UpsertReport(second); err != nil {
		t.Fatalf("second UpsertReport failed: %v", err)
	}

	got, err := store.GetReport("张三", "2026-06-24")
	if err != nil {
		t.Fatalf("GetReport failed: %v", err)
	}
	if got != second {
		t.Fatalf("unexpected report: %+v", got)
	}
}

func TestStoreReturnsNotFoundErrors(t *testing.T) {
	store := newTestStore(t)

	_, err := store.GetPlayer("不存在")
	if err == nil {
		t.Fatal("expected missing player to fail")
	}
	if !strings.Contains(err.Error(), "player not found: 不存在") {
		t.Fatalf("unexpected player error: %v", err)
	}

	_, err = store.GetReport("不存在", "2026-06-24")
	if err == nil {
		t.Fatal("expected missing report to fail")
	}
	if !strings.Contains(err.Error(), "report not found: 不存在 2026-06-24") {
		t.Fatalf("unexpected report error: %v", err)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "bastion.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	})
	if err := store.Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}
	return store
}
