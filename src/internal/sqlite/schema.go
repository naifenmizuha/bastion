package sqlite

import "strings"

func (s *Store) Init() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS players (
	name TEXT PRIMARY KEY,
	number INTEGER NOT NULL,
	bat_hands INTEGER NOT NULL,
	throw_hands INTEGER NOT NULL,
	positions INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	date TEXT NOT NULL,
	content TEXT NOT NULL,
	reflection TEXT NOT NULL,
	UNIQUE(name, date)
);

CREATE TABLE IF NOT EXISTS games (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	date TEXT NOT NULL CHECK(length(trim(date)) > 0),
	start_time TEXT,
	opponent TEXT NOT NULL CHECK(length(trim(opponent)) > 0),
	batting_side INTEGER NOT NULL CHECK(batting_side IN (0, 1)),
	own_score INTEGER NOT NULL CHECK(own_score >= 0),
	opponent_score INTEGER NOT NULL CHECK(opponent_score >= 0),
	is_final BOOLEAN NOT NULL,
	raw TEXT NOT NULL CHECK(length(trim(raw)) > 0),
	created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
);

CREATE TABLE IF NOT EXISTS game_lineups (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	team INTEGER NOT NULL CHECK(team IN (0, 1)),
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	batting_order INTEGER CHECK(batting_order IS NULL OR batting_order BETWEEN 1 AND 9),
	starting_position INTEGER CHECK(starting_position IS NULL OR starting_position BETWEEN 1 AND 9),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
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
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_analyses (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL UNIQUE,
	result INTEGER NOT NULL CHECK(result BETWEEN 0 AND 3),
	own_runs INTEGER NOT NULL CHECK(own_runs >= 0),
	opponent_runs INTEGER NOT NULL CHECK(opponent_runs >= 0),
	players_analyzed INTEGER NOT NULL CHECK(players_analyzed >= 0),
	generated_at TEXT NOT NULL CHECK(length(trim(generated_at)) > 0),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_player_performance_summaries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	batting_order INTEGER CHECK(batting_order IS NULL OR batting_order BETWEEN 1 AND 9),
	positions TEXT,
	batting_available BOOLEAN NOT NULL,
	baserunning_available BOOLEAN NOT NULL,
	pitching_available BOOLEAN NOT NULL,
	fielding_available BOOLEAN NOT NULL,
	highlight TEXT,
	risk TEXT,
	UNIQUE(game_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_player_batting_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
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
	UNIQUE(game_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_player_baserunning_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	player TEXT NOT NULL CHECK(length(trim(player)) > 0),
	runs INTEGER NOT NULL,
	stolen_bases INTEGER NOT NULL,
	caught_stealing INTEGER NOT NULL,
	stolen_base_attempts INTEGER NOT NULL,
	stolen_base_percentage REAL NOT NULL,
	extra_bases_taken INTEGER NOT NULL,
	baserunning_outs INTEGER NOT NULL,
	UNIQUE(game_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_player_pitching_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
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
	UNIQUE(game_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_player_fielding_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
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
	UNIQUE(game_id, player),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS game_analysis_data_gaps (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	scope TEXT NOT NULL CHECK(length(trim(scope)) > 0),
	message TEXT NOT NULL CHECK(length(trim(message)) > 0),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS drill_recommendations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL CHECK(length(trim(name)) > 0),
	url TEXT NOT NULL CHECK(length(trim(url)) > 0),
	reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
	type INTEGER NOT NULL CHECK(type BETWEEN 0 AND 6),
	summary TEXT NOT NULL CHECK(length(trim(summary)) > 0),
	status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0, 1, 2)),
	reviewed_by TEXT,
	reviewed_at TEXT,
	created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
);
`)
	if err != nil {
		return err
	}
	// 旧库（建库时无审批三列）幂等升级：ADD COLUMN 已存在时 SQLite 报 "duplicate column"，忽略即可。
	return s.migrateDrillRecommendations()
}

func (s *Store) migrateDrillRecommendations() error {
	migrations := []string{
		`ALTER TABLE drill_recommendations ADD COLUMN status INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE drill_recommendations ADD COLUMN reviewed_by TEXT`,
		`ALTER TABLE drill_recommendations ADD COLUMN reviewed_at TEXT`,
	}
	for _, statement := range migrations {
		if _, err := s.db.Exec(statement); err != nil {
			if !strings.Contains(err.Error(), "duplicate column") {
				return err
			}
		}
	}
	return nil
}
