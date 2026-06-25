package sqlite

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

CREATE TABLE IF NOT EXISTS plate_appearances (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	game_id INTEGER NOT NULL,
	inning INTEGER NOT NULL CHECK(inning >= 1),
	half INTEGER NOT NULL CHECK(half IN (0, 1)),
	batter TEXT NOT NULL CHECK(length(trim(batter)) > 0),
	pitcher TEXT,
	event_type INTEGER NOT NULL CHECK(event_type BETWEEN 0 AND 10),
	pitch_sequence TEXT,
	outs INTEGER NOT NULL CHECK(outs IN (0, 1, 2)),
	base_state INTEGER NOT NULL CHECK(base_state BETWEEN 0 AND 7),
	runs_scored INTEGER NOT NULL CHECK(runs_scored >= 0),
	description TEXT NOT NULL CHECK(length(trim(description)) > 0),
	FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS drill_recommendations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL CHECK(length(trim(name)) > 0),
	url TEXT NOT NULL CHECK(length(trim(url)) > 0),
	reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
	type INTEGER NOT NULL CHECK(type BETWEEN 0 AND 6),
	summary TEXT NOT NULL CHECK(length(trim(summary)) > 0),
	created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
);
`)
	return err
}
