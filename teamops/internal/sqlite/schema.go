package sqlite

// Init 创建当前版本的数据表，并补齐旧数据库缺少的兼容字段。
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
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_lineup_per_game
ON lineups(game_id)
WHERE status = 1;

CREATE TABLE IF NOT EXISTS lineup_entries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	lineup_id INTEGER NOT NULL,
	player TEXT NOT NULL,
	role INTEGER NOT NULL CHECK(role IN (0, 1)),
	batting_order INTEGER CHECK(batting_order IS NULL OR batting_order BETWEEN 1 AND 9),
	position INTEGER CHECK(position IS NULL OR position BETWEEN 1 AND 9),
	suggested_role TEXT,
	FOREIGN KEY(lineup_id) REFERENCES lineups(id) ON DELETE CASCADE,
	FOREIGN KEY(player) REFERENCES players(name),
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
	player TEXT NOT NULL,
	sequence INTEGER NOT NULL CHECK(sequence > 0),
	role INTEGER NOT NULL CHECK(role IN (0, 1)),
	planned_innings INTEGER CHECK(planned_innings IS NULL OR planned_innings > 0),
	FOREIGN KEY(lineup_id) REFERENCES lineups(id) ON DELETE CASCADE,
	FOREIGN KEY(player) REFERENCES players(name),
	UNIQUE(lineup_id, player),
	UNIQUE(lineup_id, sequence)
);

CREATE TABLE IF NOT EXISTS drill_recommendations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
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
	created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
);
`)
	if err != nil {
		return err
	}
	return s.ensureDrillRecommendationReviewColumns()
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
