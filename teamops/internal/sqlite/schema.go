package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"teamops/internal/domain/player"
)

const schemaVersion = 2

// Init 创建当前版本的数据表，并补齐旧数据库缺少的兼容字段。
func (s *Store) Init() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS schema_meta (
	id INTEGER PRIMARY KEY CHECK(id = 1),
	version INTEGER NOT NULL CHECK(version >= 1),
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	player_key TEXT NOT NULL UNIQUE CHECK(length(trim(player_key)) > 0),
	team_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	number INTEGER NOT NULL,
	bat_hands INTEGER NOT NULL,
	throw_hands INTEGER NOT NULL,
	positions INTEGER NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(team_id) REFERENCES teams(id),
	UNIQUE(team_id, name)
);

CREATE TABLE IF NOT EXISTS teams (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
	id INTEGER PRIMARY KEY CHECK(id = 1),
	own_team_id INTEGER NOT NULL,
	initialized_at TEXT,
	FOREIGN KEY(own_team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS training_reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	player_id INTEGER,
	name TEXT NOT NULL,
	date TEXT NOT NULL,
	content TEXT NOT NULL,
	reflection TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(name, date),
	FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS games (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	date TEXT NOT NULL CHECK(length(trim(date)) > 0),
	start_time TEXT CHECK(start_time IS NULL OR (length(start_time)=5 AND substr(start_time,3,1)=':' AND substr(start_time,1,2) BETWEEN '00' AND '23' AND substr(start_time,4,2) BETWEEN '00' AND '59')),
	opponent TEXT NOT NULL CHECK(length(trim(opponent)) > 0),
	own_team_id INTEGER NOT NULL,
	opponent_team_id INTEGER NOT NULL,
	batting_side INTEGER NOT NULL CHECK(batting_side IN (0, 1)),
	own_score INTEGER NOT NULL CHECK(own_score >= 0),
	opponent_score INTEGER NOT NULL CHECK(opponent_score >= 0),
	is_final BOOLEAN NOT NULL,
	raw TEXT NOT NULL CHECK(length(trim(raw)) > 0),
	created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK(length(trim(updated_at)) > 0),
	FOREIGN KEY(own_team_id) REFERENCES teams(id),
	FOREIGN KEY(opponent_team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS game_lineups (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	player_id INTEGER,
	team INTEGER NOT NULL CHECK(team IN (0, 1)),
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	batting_order INTEGER CHECK(batting_order IS NULL OR batting_order BETWEEN 1 AND 9),
	starting_position INTEGER CHECK(starting_position IS NULL OR starting_position BETWEEN 1 AND 9),
	FOREIGN KEY(game_id) REFERENCES games(id),
	FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS game_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	player_id INTEGER,
	related_player_id INTEGER,
	rbi_player_id INTEGER,
	inning INTEGER NOT NULL CHECK(inning >= 1),
	half INTEGER NOT NULL CHECK(half IN (0, 1)),
	play_no INTEGER CHECK(play_no IS NULL OR play_no > 0),
	sequence INTEGER NOT NULL CHECK(sequence > 0),
	event_kind INTEGER NOT NULL CHECK(event_kind BETWEEN 0 AND 2),
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	team INTEGER NOT NULL CHECK(team IN (0, 1)),
	result INTEGER NOT NULL,
	related_player TEXT,
	pitch_sequence TEXT,
	base_from INTEGER CHECK(base_from IS NULL OR base_from BETWEEN 0 AND 3),
	base_to INTEGER CHECK(base_to IS NULL OR base_to BETWEEN 1 AND 4),
	reason INTEGER CHECK(reason IS NULL OR reason BETWEEN 0 AND 9),
	outs_on_play INTEGER NOT NULL CHECK(outs_on_play >= 0),
	runs_scored INTEGER NOT NULL CHECK(runs_scored >= 0),
	rbi_player TEXT,
	earned BOOLEAN,
	value INTEGER NOT NULL CHECK(value >= 0),
	description TEXT,
	FOREIGN KEY(game_id) REFERENCES games(id),
	FOREIGN KEY(player_id) REFERENCES players(id),
	FOREIGN KEY(related_player_id) REFERENCES players(id),
	FOREIGN KEY(rbi_player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS game_analyses (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL UNIQUE,
	result INTEGER NOT NULL CHECK(result BETWEEN 0 AND 3),
	own_runs INTEGER NOT NULL CHECK(own_runs >= 0),
	opponent_runs INTEGER NOT NULL CHECK(opponent_runs >= 0),
	players_analyzed INTEGER NOT NULL CHECK(players_analyzed >= 0),
	generated_at TEXT NOT NULL CHECK(length(trim(generated_at)) > 0),
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK(length(trim(updated_at)) > 0),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_player_performance_summaries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	team_id INTEGER NOT NULL,
	player_id INTEGER,
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	batting_order INTEGER CHECK(batting_order IS NULL OR batting_order BETWEEN 1 AND 9),
	positions TEXT,
	batting_available BOOLEAN NOT NULL,
	baserunning_available BOOLEAN NOT NULL,
	pitching_available BOOLEAN NOT NULL,
	fielding_available BOOLEAN NOT NULL,
	highlight TEXT,
	risk TEXT,
	UNIQUE(game_id, team_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id),
	FOREIGN KEY(team_id) REFERENCES teams(id),
	FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS game_player_batting_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	team_id INTEGER NOT NULL,
	player_id INTEGER,
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	pa INTEGER NOT NULL,
	at_bats INTEGER NOT NULL,
	hits INTEGER NOT NULL,
	singles INTEGER NOT NULL,
	doubles INTEGER NOT NULL,
	triples INTEGER NOT NULL,
	homeruns INTEGER NOT NULL,
	walks INTEGER NOT NULL,
	hit_by_pitch INTEGER NOT NULL,
	strikeouts INTEGER NOT NULL,
	reached_on_error INTEGER NOT NULL,
	runs_batted_in INTEGER NOT NULL,
	total_bases INTEGER NOT NULL,
	batting_average REAL NOT NULL,
	on_base_percentage REAL NOT NULL,
	slugging_percentage REAL NOT NULL,
	ops REAL NOT NULL,
	UNIQUE(game_id, team_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id),
	FOREIGN KEY(team_id) REFERENCES teams(id),
	FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS game_player_baserunning_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	team_id INTEGER NOT NULL,
	player_id INTEGER,
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	runs INTEGER NOT NULL,
	stolen_bases INTEGER NOT NULL,
	caught_stealing INTEGER NOT NULL,
	stolen_base_attempts INTEGER NOT NULL,
	stolen_base_percentage REAL NOT NULL,
	extra_bases_taken INTEGER NOT NULL,
	baserunning_outs INTEGER NOT NULL,
	UNIQUE(game_id, team_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id),
	FOREIGN KEY(team_id) REFERENCES teams(id),
	FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS game_player_pitching_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	team_id INTEGER NOT NULL,
	player_id INTEGER,
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	outs_recorded INTEGER NOT NULL,
	innings_pitched REAL NOT NULL,
	batters_faced INTEGER NOT NULL,
	hits_allowed INTEGER NOT NULL,
	walks_allowed INTEGER NOT NULL,
	strikeouts INTEGER NOT NULL,
	homeruns_allowed INTEGER NOT NULL,
	runs_allowed INTEGER NOT NULL,
	earned_runs INTEGER NOT NULL,
	ra9 REAL NOT NULL,
	era REAL,
	whip REAL NOT NULL,
	strikeout_walk_ratio REAL,
	wild_pitches INTEGER NOT NULL,
	balks INTEGER NOT NULL,
	pickoffs INTEGER NOT NULL,
	hit_batters INTEGER NOT NULL,
	UNIQUE(game_id, team_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id),
	FOREIGN KEY(team_id) REFERENCES teams(id),
	FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS game_player_fielding_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	team_id INTEGER NOT NULL,
	player_id INTEGER,
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	positions TEXT,
	putouts INTEGER NOT NULL,
	assists INTEGER NOT NULL,
	errors INTEGER NOT NULL,
	total_chances INTEGER NOT NULL,
	fielding_percentage REAL NOT NULL,
	double_plays INTEGER NOT NULL,
	passed_balls INTEGER NOT NULL,
	outfield_assists INTEGER NOT NULL,
	UNIQUE(game_id, team_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id),
	FOREIGN KEY(team_id) REFERENCES teams(id),
	FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS game_analysis_data_gaps (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	scope TEXT NOT NULL CHECK(length(trim(scope)) > 0),
	message TEXT NOT NULL CHECK(length(trim(message)) > 0),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS lineups (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	schema_version TEXT NOT NULL CHECK(length(trim(schema_version)) > 0),
	status INTEGER NOT NULL CHECK(status BETWEEN 0 AND 3),
	strategy TEXT,
	reasoning_json TEXT NOT NULL,
	warnings_json TEXT NOT NULL,
	created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
	accepted_at TEXT,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK(length(trim(updated_at)) > 0),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_lineup_per_game
ON lineups(game_id)
WHERE status = 1;

CREATE TABLE IF NOT EXISTS lineup_entries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	lineup_id INTEGER NOT NULL,
	player_id INTEGER,
	player TEXT NOT NULL,
	role INTEGER NOT NULL CHECK(role IN (0, 1)),
	batting_order INTEGER CHECK(batting_order IS NULL OR batting_order BETWEEN 1 AND 9),
	position INTEGER CHECK(position IS NULL OR position BETWEEN 1 AND 9),
	suggested_role TEXT,
	FOREIGN KEY(lineup_id) REFERENCES lineups(id) ON DELETE CASCADE,
	FOREIGN KEY(player_id) REFERENCES players(id),
	UNIQUE(lineup_id, player)
);

CREATE UNIQUE INDEX IF NOT EXISTS lineup_unique_batting_order
ON lineup_entries(lineup_id, batting_order)
WHERE role = 0 AND batting_order IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lineup_unique_position
ON lineup_entries(lineup_id, position)
WHERE role = 0 AND position IS NOT NULL;

CREATE TABLE IF NOT EXISTS lineup_pitching_plans (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	lineup_id INTEGER NOT NULL,
	player_id INTEGER,
	player TEXT NOT NULL,
	sequence INTEGER NOT NULL CHECK(sequence > 0),
	role INTEGER NOT NULL CHECK(role IN (0, 1)),
	planned_innings INTEGER CHECK(planned_innings IS NULL OR planned_innings > 0),
	FOREIGN KEY(lineup_id) REFERENCES lineups(id) ON DELETE CASCADE,
	FOREIGN KEY(player_id) REFERENCES players(id),
	UNIQUE(lineup_id, player),
	UNIQUE(lineup_id, sequence)
);

CREATE TABLE IF NOT EXISTS drill_recommendations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	player_id INTEGER,
	name TEXT NOT NULL CHECK(length(trim(name)) > 0),
	url TEXT NOT NULL CHECK(length(trim(url)) > 0),
	reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
	type INTEGER NOT NULL CHECK(type BETWEEN 0 AND 6),
	summary TEXT NOT NULL CHECK(length(trim(summary)) > 0),
	is_approved BOOLEAN NOT NULL DEFAULT 0,
	reviewed_by TEXT,
	review_summary TEXT,
	review_note TEXT,
	reviewed_at TEXT,
	created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK(length(trim(updated_at)) > 0),
	FOREIGN KEY(player_id) REFERENCES players(id)
);
`)
	if err != nil {
		return err
	}
	if err := s.ensureDrillRecommendationReviewColumns(); err != nil {
		return err
	}
	if err := s.ensureUpdatedAtColumns(); err != nil {
		return err
	}
	if err := s.ensureTeamSchema(); err != nil {
		return err
	}
	return s.withTx(func(tx *sql.Tx) error { return s.ensureIdentitySchema(tx) })
}

func (s *Store) ensureTeamSchema() error {
	// CREATE order is intentionally repaired here for existing databases and
	// SQLite installations where players predates teams.
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE CHECK(length(trim(name))>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS app_config (id INTEGER PRIMARY KEY CHECK(id=1),own_team_id INTEGER NOT NULL,initialized_at TEXT,FOREIGN KEY(own_team_id) REFERENCES teams(id));`); err != nil {
		return err
	}
	var hasID bool
	if err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM pragma_table_info('players') WHERE name='id')`).Scan(&hasID); err != nil {
		return err
	}
	if !hasID {
		if _, err := s.db.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
			return err
		}
		if _, err := s.db.Exec(`PRAGMA legacy_alter_table=ON`); err != nil {
			return err
		}
		err := s.withTx(func(tx *sql.Tx) error {
			now := nowTimestamp()
			res, err := tx.Exec(`INSERT OR IGNORE INTO teams(name,created_at,updated_at) VALUES(?,?,?)`, legacyOwnTeamName, now, now)
			if err != nil {
				return err
			}
			ownID, err := res.LastInsertId()
			if err != nil {
				return err
			}
			if ownID == 0 {
				if err := tx.QueryRow(`SELECT id FROM teams WHERE name=?`, legacyOwnTeamName).Scan(&ownID); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(`ALTER TABLE players RENAME TO players_legacy`); err != nil {
				return err
			}
			if _, err := tx.Exec(`CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT,team_id INTEGER NOT NULL,name TEXT NOT NULL,number INTEGER NOT NULL,bat_hands INTEGER NOT NULL,throw_hands INTEGER NOT NULL,positions INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(team_id) REFERENCES teams(id),UNIQUE(team_id,name))`); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO players(team_id,name,number,bat_hands,throw_hands,positions,updated_at) SELECT ?,name,number,bat_hands,throw_hands,positions,updated_at FROM players_legacy`, ownID); err != nil {
				return err
			}
			if _, err := tx.Exec(`DROP TABLE players_legacy`); err != nil {
				return err
			}
			_, err = tx.Exec(`INSERT OR IGNORE INTO app_config(id,own_team_id,initialized_at) VALUES(1,?,NULL)`, ownID)
			return err
		})
		_, legacyErr := s.db.Exec(`PRAGMA legacy_alter_table=OFF`)
		_, enableErr := s.db.Exec(`PRAGMA foreign_keys=ON`)
		if err != nil {
			return err
		}
		if legacyErr != nil {
			return legacyErr
		}
		if enableErr != nil {
			return enableErr
		}
	}
	// Additive columns keep migration idempotent. Legacy analysis rows belong to
	// the pending/current own team; new rows always receive an explicit team id.
	columns := []struct{ table, name, definition string }{{"games", "own_team_id", "INTEGER"}, {"games", "opponent_team_id", "INTEGER"}, {"game_player_performance_summaries", "team_id", "INTEGER"}, {"game_player_batting_stats", "team_id", "INTEGER"}, {"game_player_baserunning_stats", "team_id", "INTEGER"}, {"game_player_pitching_stats", "team_id", "INTEGER"}, {"game_player_fielding_stats", "team_id", "INTEGER"}}
	for _, c := range columns {
		ok, err := s.columnExists(c.table, c.name)
		if err != nil {
			return err
		}
		if !ok {
			if _, err := s.db.Exec("ALTER TABLE " + c.table + " ADD COLUMN " + c.name + " " + c.definition); err != nil {
				return err
			}
		}
	}
	var ownID int64
	if err := s.db.QueryRow(`SELECT own_team_id FROM app_config WHERE id=1`).Scan(&ownID); errors.Is(err, sql.ErrNoRows) {
		var hasLegacyData bool
		if err := s.db.QueryRow(`SELECT EXISTS(
			SELECT 1 FROM players
			UNION ALL SELECT 1 FROM games
			UNION ALL SELECT 1 FROM training_reports
			UNION ALL SELECT 1 FROM drill_recommendations
			UNION ALL SELECT 1 FROM lineups
		)`).Scan(&hasLegacyData); err != nil {
			return err
		}
		if hasLegacyData {
			now := nowTimestamp()
			res, e := s.db.Exec(`INSERT OR IGNORE INTO teams(name,created_at,updated_at) VALUES(?,?,?)`, legacyOwnTeamName, now, now)
			if e != nil {
				return e
			}
			ownID, _ = res.LastInsertId()
			if ownID == 0 {
				if err := s.db.QueryRow(`SELECT id FROM teams WHERE name=?`, legacyOwnTeamName).Scan(&ownID); err != nil {
					return err
				}
			}
			if _, err = s.db.Exec(`INSERT OR IGNORE INTO app_config(id,own_team_id,initialized_at) VALUES(1,?,NULL)`, ownID); err != nil {
				return err
			}
		}
	} else if err != nil {
		return err
	}
	if ownID != 0 {
		for _, table := range []string{"game_player_performance_summaries", "game_player_batting_stats", "game_player_baserunning_stats", "game_player_pitching_stats", "game_player_fielding_stats"} {
			if _, err := s.db.Exec("UPDATE "+table+" SET team_id=? WHERE team_id IS NULL", ownID); err != nil {
				return err
			}
		}
	}
	rows, err := s.db.Query(`SELECT DISTINCT opponent FROM games WHERE opponent_team_id IS NULL`)
	if err != nil {
		return err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return err
		}
		names = append(names, n)
	}
	rows.Close()
	for _, n := range names {
		now := nowTimestamp()
		if _, err := s.db.Exec(`INSERT OR IGNORE INTO teams(name,created_at,updated_at) VALUES(?,?,?)`, strings.TrimSpace(n), now, now); err != nil {
			return err
		}
	}
	if ownID != 0 {
		_, err = s.db.Exec(`UPDATE games SET own_team_id=?, opponent_team_id=(SELECT id FROM teams WHERE name=trim(games.opponent)) WHERE own_team_id IS NULL OR opponent_team_id IS NULL`, ownID)
		if err != nil {
			return err
		}
	}
	return s.rebuildTeamKeyTables()
}

// ensureIdentitySchema upgrades name-only records to database-local player
// identities. The migration is additive so legacy name snapshots remain
// readable and temporary game participants can still have a NULL player_id.
func (s *Store) ensureIdentitySchema(tx *sql.Tx) error {
	var current int
	if err := tx.QueryRow(`SELECT version FROM schema_meta WHERE id=1`).Scan(&current); err == nil && current > schemaVersion {
		return fmt.Errorf("database schema version %d is newer than supported version %d", current, schemaVersion)
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	columns := []struct{ table, name, definition string }{
		{"players", "player_key", "TEXT"},
		{"training_reports", "player_id", "INTEGER"},
		{"game_lineups", "player_id", "INTEGER"},
		{"game_events", "player_id", "INTEGER"},
		{"game_events", "related_player_id", "INTEGER"},
		{"game_events", "rbi_player_id", "INTEGER"},
		{"game_player_performance_summaries", "player_id", "INTEGER"},
		{"game_player_batting_stats", "player_id", "INTEGER"},
		{"game_player_baserunning_stats", "player_id", "INTEGER"},
		{"game_player_pitching_stats", "player_id", "INTEGER"},
		{"game_player_fielding_stats", "player_id", "INTEGER"},
		{"lineup_entries", "player_id", "INTEGER"},
		{"lineup_pitching_plans", "player_id", "INTEGER"},
		{"drill_recommendations", "player_id", "INTEGER"},
	}
	for _, column := range columns {
		exists, err := columnExistsTx(tx, column.table, column.name)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := tx.Exec("ALTER TABLE " + column.table + " ADD COLUMN " + column.name + " " + column.definition); err != nil {
				return err
			}
		}
	}

	rows, err := tx.Query(`SELECT id FROM players WHERE player_key IS NULL OR trim(player_key)='' ORDER BY id`)
	if err != nil {
		return err
	}
	var playerIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		playerIDs = append(playerIDs, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range playerIDs {
		key, err := player.NewKey()
		if err != nil {
			return fmt.Errorf("generate player key: %w", err)
		}
		if _, err := tx.Exec(`UPDATE players SET player_key=? WHERE id=?`, key, id); err != nil {
			return err
		}
	}

	backfills := []string{
		`UPDATE training_reports SET player_id=(SELECT p.id FROM players p JOIN app_config c ON c.id=1 WHERE p.team_id=c.own_team_id AND p.name=training_reports.name) WHERE player_id IS NULL`,
		`UPDATE drill_recommendations SET player_id=(SELECT p.id FROM players p JOIN app_config c ON c.id=1 WHERE p.team_id=c.own_team_id AND p.name=drill_recommendations.name) WHERE player_id IS NULL`,
		`UPDATE game_lineups SET player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_lineups.game_id WHERE p.team_id=CASE game_lineups.team WHEN 0 THEN g.own_team_id ELSE g.opponent_team_id END AND p.name=game_lineups.player) WHERE player_id IS NULL`,
		`UPDATE game_events SET player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_events.game_id WHERE p.team_id=CASE game_events.team WHEN 0 THEN g.own_team_id ELSE g.opponent_team_id END AND p.name=game_events.player) WHERE player_id IS NULL`,
		`UPDATE game_events SET related_player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_events.game_id WHERE p.team_id=CASE game_events.team WHEN 0 THEN g.opponent_team_id ELSE g.own_team_id END AND p.name=game_events.related_player) WHERE related_player_id IS NULL AND related_player IS NOT NULL`,
		`UPDATE game_events SET rbi_player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_events.game_id WHERE p.team_id=CASE game_events.team WHEN 0 THEN g.own_team_id ELSE g.opponent_team_id END AND p.name=game_events.rbi_player) WHERE rbi_player_id IS NULL AND rbi_player IS NOT NULL`,
		`UPDATE lineup_entries SET player_id=(SELECT p.id FROM players p JOIN lineups l ON l.id=lineup_entries.lineup_id JOIN games g ON g.id=l.game_id WHERE p.team_id=g.own_team_id AND p.name=lineup_entries.player) WHERE player_id IS NULL`,
		`UPDATE lineup_pitching_plans SET player_id=(SELECT p.id FROM players p JOIN lineups l ON l.id=lineup_pitching_plans.lineup_id JOIN games g ON g.id=l.game_id WHERE p.team_id=g.own_team_id AND p.name=lineup_pitching_plans.player) WHERE player_id IS NULL`,
	}
	for _, table := range []string{"game_player_performance_summaries", "game_player_batting_stats", "game_player_baserunning_stats", "game_player_pitching_stats", "game_player_fielding_stats"} {
		backfills = append(backfills, "UPDATE "+table+" SET player_id=(SELECT p.id FROM players p WHERE p.team_id="+table+".team_id AND p.name="+table+".player) WHERE player_id IS NULL")
	}
	for _, query := range backfills {
		if _, err := tx.Exec(query); err != nil {
			return err
		}
	}

	if err := rejectIdentityDuplicates(tx); err != nil {
		return err
	}
	indexes := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS players_player_key_unique ON players(player_key)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS game_lineups_game_team_player_id ON game_lineups(game_id,team,player_id) WHERE player_id IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS game_lineups_game_team_player_name ON game_lineups(game_id,team,lower(trim(player))) WHERE player_id IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS game_lineups_game_team_batting_order ON game_lineups(game_id,team,batting_order) WHERE batting_order IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS game_events_logical_play ON game_events(game_id,inning,half,play_no,sequence) WHERE play_no IS NOT NULL`,
	}
	for _, statement := range indexes {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`
CREATE TRIGGER IF NOT EXISTS players_player_key_required_insert BEFORE INSERT ON players
WHEN NEW.player_key IS NULL OR length(trim(NEW.player_key))=0 BEGIN SELECT RAISE(ABORT,'player_key is required'); END;
CREATE TRIGGER IF NOT EXISTS players_player_key_immutable BEFORE UPDATE OF player_key ON players
WHEN NEW.player_key IS NOT OLD.player_key BEGIN SELECT RAISE(ABORT,'player_key is immutable'); END;
`); err != nil {
		return err
	}
	_, err = tx.Exec(`
INSERT INTO schema_meta(id,version,updated_at) VALUES(1,?,?)
ON CONFLICT(id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at
WHERE schema_meta.version <> excluded.version
`, schemaVersion, nowTimestamp())
	return err
}

func rejectIdentityDuplicates(tx *sql.Tx) error {
	checks := []struct {
		name  string
		query string
	}{
		{"game_lineups player", `SELECT printf('%d/%d/%s',game_id,team,player) FROM game_lineups GROUP BY game_id,team,lower(trim(player)) HAVING count(*)>1 LIMIT 1`},
		{"game_lineups batting order", `SELECT printf('%d/%d/%d',game_id,team,batting_order) FROM game_lineups WHERE batting_order IS NOT NULL GROUP BY game_id,team,batting_order HAVING count(*)>1 LIMIT 1`},
		{"game_events logical play", `SELECT printf('%d/%d/%d/%d/%d',game_id,inning,half,play_no,sequence) FROM game_events WHERE play_no IS NOT NULL GROUP BY game_id,inning,half,play_no,sequence HAVING count(*)>1 LIMIT 1`},
	}
	for _, check := range checks {
		var key string
		err := tx.QueryRow(check.query).Scan(&key)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		return fmt.Errorf("schema migration conflict in %s: %s", check.name, key)
	}
	return nil
}

func (s *Store) rebuildTeamKeyTables() error {
	// SQLite cannot drop table-level UNIQUE constraints. Rebuild legacy derived
	// tables once so both sides may contain players with the same name.
	for _, table := range []string{"game_player_performance_summaries", "game_player_batting_stats", "game_player_baserunning_stats", "game_player_pitching_stats", "game_player_fielding_stats"} {
		var sqlText string
		if err := s.db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&sqlText); err != nil {
			return err
		}
		if !strings.Contains(strings.ReplaceAll(sqlText, " ", ""), "UNIQUE(game_id,player)") {
			continue
		}
		legacy := table + "_legacy_team_key"
		if _, err := s.db.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
			return err
		}
		err := s.withTx(func(tx *sql.Tx) error {
			if _, e := tx.Exec("ALTER TABLE " + table + " RENAME TO " + legacy); e != nil {
				return e
			}
			if _, e := tx.Exec("CREATE TABLE " + table + " AS SELECT * FROM " + legacy + " WHERE 0"); e != nil {
				return e
			}
			if _, e := tx.Exec("INSERT INTO " + table + " SELECT * FROM " + legacy); e != nil {
				return e
			}
			if _, e := tx.Exec("DROP TABLE " + legacy); e != nil {
				return e
			}
			_, e := tx.Exec("CREATE UNIQUE INDEX " + table + "_game_team_player ON " + table + "(game_id,team_id,player)")
			return e
		})
		s.db.Exec(`PRAGMA foreign_keys=ON`)
		if err != nil {
			return err
		}
	}
	return s.rebuildLegacyLineupForeignKeys()
}

func (s *Store) rebuildLegacyLineupForeignKeys() error {
	for _, table := range []string{"lineup_entries", "lineup_pitching_plans"} {
		var sqlText string
		if err := s.db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&sqlText); err != nil {
			return err
		}
		if !strings.Contains(strings.ReplaceAll(sqlText, " ", ""), "REFERENCESplayers(name)") {
			continue
		}
		legacy := table + "_legacy_player_fk"
		s.db.Exec(`PRAGMA foreign_keys=OFF`)
		err := s.withTx(func(tx *sql.Tx) error {
			if _, e := tx.Exec("ALTER TABLE " + table + " RENAME TO " + legacy); e != nil {
				return e
			}
			if _, e := tx.Exec("CREATE TABLE " + table + " AS SELECT * FROM " + legacy + " WHERE 0"); e != nil {
				return e
			}
			if _, e := tx.Exec("INSERT INTO " + table + " SELECT * FROM " + legacy); e != nil {
				return e
			}
			if _, e := tx.Exec("DROP TABLE " + legacy); e != nil {
				return e
			}
			_, e := tx.Exec("CREATE UNIQUE INDEX " + table + "_lineup_player ON " + table + "(lineup_id,player)")
			return e
		})
		s.db.Exec(`PRAGMA foreign_keys=ON`)
		if err != nil {
			return err
		}
	}
	return nil
}

// ensureUpdatedAtColumns 为旧数据库补充来源新鲜度时间，并使用已有时间字段回填。
func (s *Store) ensureUpdatedAtColumns() error {
	now := nowTimestamp()
	tables := []struct {
		name     string
		fallback string
	}{
		{"players", "?"},
		{"training_reports", "?"},
		{"games", "created_at"},
		{"game_analyses", "generated_at"},
		{"lineups", "COALESCE(accepted_at, created_at)"},
		{"drill_recommendations", "COALESCE(reviewed_at, created_at)"},
	}
	for _, table := range tables {
		exists, err := s.columnExists(table.name, "updated_at")
		if err != nil {
			return err
		}
		if !exists {
			if _, err := s.db.Exec("ALTER TABLE " + table.name + " ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"); err != nil {
				return err
			}
		}
		query := fmt.Sprintf("UPDATE %s SET updated_at = %s WHERE updated_at = ''", table.name, table.fallback)
		if table.fallback == "?" {
			if _, err := s.db.Exec(query, now); err != nil {
				return err
			}
		} else if _, err := s.db.Exec(query); err != nil {
			return err
		}
	}
	return nil
}

// ensureDrillRecommendationReviewColumns 为旧推荐表增补审核相关列。
func (s *Store) ensureDrillRecommendationReviewColumns() error {
	columns := map[string]string{
		"is_approved":    "ALTER TABLE drill_recommendations ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT 0",
		"reviewed_by":    "ALTER TABLE drill_recommendations ADD COLUMN reviewed_by TEXT",
		"review_summary": "ALTER TABLE drill_recommendations ADD COLUMN review_summary TEXT",
		"review_note":    "ALTER TABLE drill_recommendations ADD COLUMN review_note TEXT",
		"reviewed_at":    "ALTER TABLE drill_recommendations ADD COLUMN reviewed_at TEXT",
	}
	for column, statement := range columns {
		exists, err := s.columnExists("drill_recommendations", column)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

// columnExists 通过表结构元数据判断列是否已存在。
func (s *Store) columnExists(table string, column string) (bool, error) {
	rows, err := s.db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func columnExistsTx(tx *sql.Tx, table, column string) (bool, error) {
	rows, err := tx.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
