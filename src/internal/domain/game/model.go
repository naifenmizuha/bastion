package game

type BattingSide int

const (
	BattingSideTop BattingSide = iota
	BattingSideBottom
)

type Team int

const (
	TeamOwn Team = iota
	TeamOpponent
)

type Half int

const (
	HalfTop Half = iota
	HalfBottom
)

type EventType int

const (
	EventTypeOther EventType = iota
	EventTypeSingle
	EventTypeDouble
	EventTypeTriple
	EventTypeHomerun
	EventTypeWalk
	EventTypeStrikeout
	EventTypeGroundout
	EventTypeFlyout
	EventTypeError
	EventTypeSteal
)

type Game struct {
	ID            int64       `json:"id"`
	Date          string      `json:"date"`
	StartTime     string      `json:"start_time"`
	Opponent      string      `json:"opponent"`
	BattingSide   BattingSide `json:"batting_side"`
	OwnScore      int         `json:"own_score"`
	OpponentScore int         `json:"opponent_score"`
	IsFinal       bool        `json:"is_final"`
	Raw           string      `json:"raw"`
	CreatedAt     string      `json:"created_at"`
}

type GameLineup struct {
	ID               int64  `json:"id"`
	GameID           int64  `json:"game_id"`
	Team             Team   `json:"team"`
	Player           string `json:"player"`
	BattingOrder     *int   `json:"batting_order"`
	StartingPosition *int   `json:"starting_position"`
}

type PlateAppearance struct {
	ID            int64     `json:"id"`
	GameID        int64     `json:"game_id"`
	Inning        int       `json:"inning"`
	Half          Half      `json:"half"`
	Batter        string    `json:"batter"`
	Pitcher       string    `json:"pitcher"`
	EventType     EventType `json:"event_type"`
	PitchSequence string    `json:"pitch_sequence"`
	Outs          int       `json:"outs"`
	BaseState     int       `json:"base_state"`
	RunsScored    int       `json:"runs_scored"`
	Description   string    `json:"description"`
}

type GameDetails struct {
	Game    Game
	Lineups []GameLineup
	Events  []PlateAppearance
}

type GameListFilter struct {
	Date string
}
