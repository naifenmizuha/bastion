package sqlite

import (
	"strings"
	"testing"

	"teamops/internal/domain/game"
	"teamops/internal/domain/player"
)

func TestSchemaV2AndPlayerKeyRetry(t *testing.T) {
	store := newTestStore(t)
	var version int
	if err := store.db.QueryRow(`SELECT version FROM schema_meta WHERE id=1`).Scan(&version); err != nil || version != 2 {
		t.Fatalf("schema version = %d, err=%v", version, err)
	}
	var notNull int
	if err := store.db.QueryRow(`SELECT "notnull" FROM pragma_table_info('players') WHERE name='player_key'`).Scan(&notNull); err != nil || notNull != 1 {
		t.Fatalf("players.player_key notnull=%d err=%v", notNull, err)
	}
	p := player.Player{Name: "Agent Player", Number: 7, Bat: player.HandRight, Throw: player.HandLeft, Positions: player.PositionOutfield}
	forbidden := p
	forbidden.Key = "ply_caller_supplied"
	if _, _, err := store.AddPlayerReturning(forbidden); err == nil || !strings.Contains(err.Error(), "must not specify") {
		t.Fatalf("expected caller-supplied key rejection, got %v", err)
	}
	first, created, err := store.AddPlayerReturning(p)
	if err != nil || !created || !strings.HasPrefix(first.Key, "ply_") {
		t.Fatalf("first add = %+v created=%v err=%v", first, created, err)
	}
	second, created, err := store.AddPlayerReturning(p)
	if err != nil || created || second.ID != first.ID || second.Key != first.Key {
		t.Fatalf("retry = %+v created=%v err=%v", second, created, err)
	}
	p.Number = 8
	if _, _, err := store.AddPlayerReturning(p); err == nil || !strings.Contains(err.Error(), first.Key) {
		t.Fatalf("expected conflict with existing key, got %v", err)
	}
}

func TestInitDoesNotTouchSchemaMetadataAtCurrentVersion(t *testing.T) {
	store := newTestStore(t)
	const sentinel = "2025-09-28T23:59:59Z"
	if _, err := store.db.Exec(`UPDATE schema_meta SET updated_at=? WHERE id=1`, sentinel); err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	var updatedAt string
	if err := store.db.QueryRow(`SELECT updated_at FROM schema_meta WHERE id=1`).Scan(&updatedAt); err != nil {
		t.Fatal(err)
	}
	if updatedAt != sentinel {
		t.Fatalf("current schema init changed updated_at: got %q, want %q", updatedAt, sentinel)
	}
}

func TestGameEventLogicalUpsertAndAppend(t *testing.T) {
	store := newTestStore(t)
	gameID, err := store.CreateGame(game.Game{Date: "2026-01-01", Opponent: "Opponent", BattingSide: game.BattingSideTop, Raw: "raw"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	playNo := 1
	event := game.GameEvent{Inning: 1, Half: game.HalfTop, PlayNo: &playNo, Sequence: 1, EventKind: game.EventKindFieldingCredit, Player: "Temporary", Team: game.TeamOwn, Result: int(game.FieldingResultPutout), Value: 1}
	first, err := store.UpsertGameEvents(gameID, []game.GameEvent{event})
	if err != nil || first.Inserted != 1 || !first.Idempotent {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	event.Value = 2
	second, err := store.UpsertGameEvents(gameID, []game.GameEvent{event})
	if err != nil || second.Updated != 1 || !second.Idempotent {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	appendEvent := event
	appendEvent.PlayNo = nil
	third, err := store.UpsertGameEvents(gameID, []game.GameEvent{appendEvent})
	if err != nil || third.Inserted != 1 || third.Idempotent {
		t.Fatalf("third=%+v err=%v", third, err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM game_events WHERE game_id=?`, gameID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("event count=%d err=%v", count, err)
	}
}

func TestMigrationRejectsDuplicateLogicalHistory(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.db.Exec(`DROP INDEX game_lineups_game_team_player_name; DROP INDEX game_lineups_game_team_batting_order;`); err != nil {
		t.Fatal(err)
	}
	gameID, err := store.CreateGame(game.Game{Date: "2026-01-02", Opponent: "Other", BattingSide: game.BattingSideTop, Raw: "raw"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT INTO game_lineups(game_id,team,player,batting_order) VALUES(?,0,'duplicate',1),(?,0,'duplicate',2)`, gameID, gameID); err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err == nil || !strings.Contains(err.Error(), "migration conflict") {
		t.Fatalf("expected migration conflict, got %v", err)
	}
}
