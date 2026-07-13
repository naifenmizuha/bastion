package sqlite

import (
	"path/filepath"
	"strings"
	"testing"

	"teamops/internal/domain/game"
	"teamops/internal/domain/player"
	"teamops/internal/domain/report"
)

func TestStorePlayerLifecycle(t *testing.T) {
	store := newTestStore(t)

	p := player.Player{
		Name:      "张三",
		Number:    18,
		Bat:       player.HandRight,
		Throw:     player.HandRight,
		Positions: player.PositionPitcher | player.PositionShortstop,
	}
	if err := store.AddPlayer(p); err != nil {
		t.Fatalf("AddPlayer failed: %v", err)
	}

	got, err := store.GetPlayer("张三")
	if err != nil {
		t.Fatalf("GetPlayer failed: %v", err)
	}
	if got != p {
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
	if batBits != int(player.HandRight) || throwBits != int(player.HandRight) || positionBits != int(player.PositionPitcher|player.PositionShortstop) {
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
	p := player.Player{Name: "张三", Number: 18, Bat: player.HandRight, Throw: player.HandRight, Positions: player.PositionPitcher}

	if err := store.AddPlayer(p); err != nil {
		t.Fatalf("first AddPlayer failed: %v", err)
	}
	err := store.AddPlayer(p)
	if err == nil {
		t.Fatal("expected duplicate player to fail")
	}
	if !strings.Contains(err.Error(), "player already exists: 张三") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestStoreReportLifecycleAndOverwrite(t *testing.T) {
	store := newTestStore(t)
	p := player.Player{Name: "张三", Number: 18, Bat: player.HandRight, Throw: player.HandRight, Positions: player.PositionPitcher}
	if err := store.AddPlayer(p); err != nil {
		t.Fatalf("AddPlayer failed: %v", err)
	}

	first := report.Report{Name: "张三", Date: "2026-06-24", Content: "挥棒训练", Reflection: "节奏更稳定"}
	if err := store.UpsertReport(first); err != nil {
		t.Fatalf("first UpsertReport failed: %v", err)
	}
	var firstUpdatedAt string
	if err := store.db.QueryRow(`SELECT updated_at FROM training_reports WHERE name = ? AND date = ?`, first.Name, first.Date).Scan(&firstUpdatedAt); err != nil {
		t.Fatalf("read first updated_at failed: %v", err)
	}

	second := report.Report{Name: "张三", Date: "2026-06-24", Content: "守备训练", Reflection: "脚步更主动"}
	if err := store.UpsertReport(second); err != nil {
		t.Fatalf("second UpsertReport failed: %v", err)
	}
	var secondUpdatedAt string
	if err := store.db.QueryRow(`SELECT updated_at FROM training_reports WHERE name = ? AND date = ?`, second.Name, second.Date).Scan(&secondUpdatedAt); err != nil {
		t.Fatalf("read second updated_at failed: %v", err)
	}
	if firstUpdatedAt == secondUpdatedAt {
		t.Fatalf("expected report updated_at to change, still %q", firstUpdatedAt)
	}

	got, err := store.GetReport("张三", "2026-06-24")
	if err != nil {
		t.Fatalf("GetReport failed: %v", err)
	}
	if got != second {
		t.Fatalf("unexpected report: %+v", got)
	}
}

func TestInitBackfillsUpdatedAtOnLegacyTables(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer store.Close()
	if _, err := store.db.Exec(`
		CREATE TABLE players (
			name TEXT PRIMARY KEY,
			number INTEGER NOT NULL,
			bat_hands INTEGER NOT NULL,
			throw_hands INTEGER NOT NULL,
			positions INTEGER NOT NULL
		);
		INSERT INTO players VALUES ('legacy', 1, 1, 1, 1);
	`); err != nil {
		t.Fatalf("seed legacy schema failed: %v", err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("Init migration failed: %v", err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("second Init migration failed: %v", err)
	}
	var updatedAt string
	if err := store.db.QueryRow(`SELECT updated_at FROM players WHERE name = 'legacy'`).Scan(&updatedAt); err != nil {
		t.Fatalf("read migrated timestamp failed: %v", err)
	}
	if strings.TrimSpace(updatedAt) == "" {
		t.Fatal("expected legacy row updated_at to be backfilled")
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

func TestStoreGameLifecycle(t *testing.T) {
	store := newTestStore(t)
	order := 1
	position := 1

	gameID, err := store.CreateGame(
		game.Game{
			Date:          "2026-06-24",
			StartTime:     "19:30",
			Opponent:      "海港队",
			BattingSide:   game.BattingSideTop,
			OwnScore:      5,
			OpponentScore: 3,
			IsFinal:       true,
			Raw:           "6月24日对海港队，先攻，5:3获胜",
		},
		[]game.GameLineup{{
			Team:             game.TeamOwn,
			Player:           "张三",
			BattingOrder:     &order,
			StartingPosition: &position,
		}},
		[]game.GameEvent{{
			Inning:        1,
			Half:          game.HalfTop,
			Sequence:      1,
			EventKind:     game.EventKindPlateResult,
			Player:        "张三",
			Team:          game.TeamOwn,
			Result:        int(game.PlateResultSingle),
			RelatedPlayer: "李四",
			PitchSequence: "B,S,X",
			Value:         1,
			Description:   "张三中前安打",
		}},
	)
	if err != nil {
		t.Fatalf("CreateGame failed: %v", err)
	}
	if gameID != 1 {
		t.Fatalf("unexpected game id: %d", gameID)
	}

	details, err := store.GetGame(gameID)
	if err != nil {
		t.Fatalf("GetGame failed: %v", err)
	}
	if details.Game.Opponent != "海港队" || !details.Game.IsFinal || len(details.Lineups) != 1 || len(details.Events) != 1 {
		t.Fatalf("unexpected details: %+v", details)
	}

	unfinalID, err := store.CreateGame(game.Game{
		Date:        "2026-06-25",
		Opponent:    "山城队",
		BattingSide: game.BattingSideBottom,
		Raw:         "6月25日对山城队",
	}, nil, nil)
	if err != nil {
		t.Fatalf("CreateGame unfinal failed: %v", err)
	}
	lineupID, err := store.AddGameLineup(game.GameLineup{GameID: unfinalID, Team: game.TeamOwn, Player: "王五"})
	if err != nil {
		t.Fatalf("AddGameLineup failed: %v", err)
	}
	if lineupID != 2 {
		t.Fatalf("unexpected lineup id: %d", lineupID)
	}
	eventCount, err := store.AddGameEvents(unfinalID, []game.GameEvent{{
		GameID:        unfinalID,
		Inning:        1,
		Half:          game.HalfTop,
		Sequence:      1,
		EventKind:     game.EventKindPlateResult,
		Player:        "王五",
		Team:          game.TeamOwn,
		Result:        int(game.PlateResultWalk),
		RelatedPlayer: "对方投手",
		PitchSequence: "B,B,B,B",
		Value:         1,
		Description:   "王五保送",
	}})
	if err != nil {
		t.Fatalf("AddGameEvents failed: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("unexpected event count: %d", eventCount)
	}
	if err := store.SetGameScore(unfinalID, 7, 6); err != nil {
		t.Fatalf("SetGameScore failed: %v", err)
	}
	details, err = store.GetGame(unfinalID)
	if err != nil {
		t.Fatalf("GetGame after score failed: %v", err)
	}
	if !details.Game.IsFinal || details.Game.OwnScore != 7 || details.Game.OpponentScore != 6 {
		t.Fatalf("score was not saved: %+v", details.Game)
	}
}

func TestStoreCreateGameRollsBackWhenChildInsertFails(t *testing.T) {
	store := newTestStore(t)

	_, err := store.CreateGame(
		game.Game{
			Date:        "2026-06-24",
			Opponent:    "海港队",
			BattingSide: game.BattingSideTop,
			Raw:         "raw",
		},
		nil,
		[]game.GameEvent{{
			Inning:    0,
			Half:      game.HalfTop,
			Sequence:  1,
			EventKind: game.EventKindPlateResult,
			Player:    "张三",
			Team:      game.TeamOwn,
			Result:    int(game.PlateResultSingle),
			Value:     1,
		}},
	)
	if err == nil {
		t.Fatal("expected invalid child insert to fail")
	}

	games, err := store.ListGames(game.GameListFilter{})
	if err != nil {
		t.Fatalf("ListGames failed: %v", err)
	}
	if len(games) != 0 {
		t.Fatalf("expected rollback to leave no games, got %+v", games)
	}
}

func TestStoreGameNotFound(t *testing.T) {
	store := newTestStore(t)

	_, err := store.GetGame(999)
	if err == nil {
		t.Fatal("expected missing game to fail")
	}
	if !strings.Contains(err.Error(), "game not found: 999") {
		t.Fatalf("unexpected get error: %v", err)
	}

	_, err = store.AddGameLineup(game.GameLineup{GameID: 999, Team: game.TeamOwn, Player: "张三"})
	if err == nil {
		t.Fatal("expected missing game lineup add to fail")
	}
	if !strings.Contains(err.Error(), "game not found: 999") {
		t.Fatalf("unexpected lineup error: %v", err)
	}

	_, err = store.AddGameEvents(999, []game.GameEvent{{Inning: 1, Half: game.HalfTop, Sequence: 1, EventKind: game.EventKindPlateResult, Player: "张三", Team: game.TeamOwn, Result: int(game.PlateResultSingle), RelatedPlayer: "李四", PitchSequence: "X", Value: 1}})
	if err == nil {
		t.Fatal("expected missing game event write to fail")
	}
	if !strings.Contains(err.Error(), "game not found: 999") {
		t.Fatalf("unexpected event error: %v", err)
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
