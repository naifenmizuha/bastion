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

type EventKind int

const (
	EventKindPlateResult EventKind = iota
	EventKindRunnerMovement
	EventKindFieldingCredit
)

type PlateResult int

const (
	PlateResultSingle PlateResult = iota
	PlateResultDouble
	PlateResultTriple
	PlateResultHomerun
	PlateResultWalk
	PlateResultHitByPitch
	PlateResultStrikeout
	PlateResultGroundout
	PlateResultFlyout
	PlateResultReachedOnError
	PlateResultFieldersChoice
	PlateResultSacrifice
	PlateResultOther
)

type RunnerResult int

const (
	RunnerResultAdvance RunnerResult = iota
	RunnerResultRunScored
	RunnerResultOut
)

type RunnerReason int

const (
	RunnerReasonBattedBall RunnerReason = iota
	RunnerReasonStolenBase
	RunnerReasonCaughtStealing
	RunnerReasonWildPitch
	RunnerReasonPassedBall
	RunnerReasonBalk
	RunnerReasonPickoff
	RunnerReasonError
	RunnerReasonFieldersChoice
	RunnerReasonOther
)

type FieldingResult int

const (
	FieldingResultPutout FieldingResult = iota
	FieldingResultAssist
	FieldingResultError
	FieldingResultDoublePlay
	FieldingResultPassedBall
	FieldingResultOutfieldAssist
	FieldingResultOther
)

type GameResult int

const (
	GameResultWin GameResult = iota
	GameResultLoss
	GameResultTie
	GameResultInProgress
)

type Game struct {
	ID             int64       `json:"id"`
	OwnTeamID      int64       `json:"own_team_id"`
	OpponentTeamID int64       `json:"opponent_team_id"`
	Date           string      `json:"date"`
	StartTime      string      `json:"start_time"`
	Opponent       string      `json:"opponent"`
	BattingSide    BattingSide `json:"batting_side"`
	OwnScore       int         `json:"own_score"`
	OpponentScore  int         `json:"opponent_score"`
	IsFinal        bool        `json:"is_final"`
	Raw            string      `json:"raw"`
	CreatedAt      string      `json:"created_at"`
	UpdatedAt      string      `json:"updated_at"`
}

type GameLineup struct {
	ID               int64  `json:"id"`
	GameID           int64  `json:"game_id"`
	PlayerID         int64  `json:"player_id"`
	PlayerKey        string `json:"player_key"`
	Team             Team   `json:"team"`
	Player           string `json:"player"`
	BattingOrder     *int   `json:"batting_order"`
	StartingPosition *int   `json:"starting_position"`
}

type GameEvent struct {
	ID               int64         `json:"id"`
	GameID           int64         `json:"game_id"`
	PlayerID         int64         `json:"player_id"`
	PlayerKey        string        `json:"player_key"`
	Inning           int           `json:"inning"`
	Half             Half          `json:"half"`
	PlayNo           *int          `json:"play_no"`
	Sequence         int           `json:"sequence"`
	EventKind        EventKind     `json:"event_kind"`
	Player           string        `json:"player"`
	Team             Team          `json:"team"`
	Result           int           `json:"result"`
	RelatedPlayer    string        `json:"related_player"`
	RelatedPlayerID  int64         `json:"related_player_id"`
	RelatedPlayerKey string        `json:"related_player_key"`
	PitchSequence    string        `json:"pitch_sequence"`
	BaseFrom         *int          `json:"base_from"`
	BaseTo           *int          `json:"base_to"`
	Reason           *RunnerReason `json:"reason"`
	OutsOnPlay       int           `json:"outs_on_play"`
	RunsScored       int           `json:"runs_scored"`
	RBIPlayer        string        `json:"rbi_player"`
	RBIPlayerID      int64         `json:"rbi_player_id"`
	RBIPlayerKey     string        `json:"rbi_player_key"`
	Earned           *bool         `json:"earned"`
	Value            int           `json:"value"`
	Description      string        `json:"description"`
}

type GameDetails struct {
	Game    Game
	Lineups []GameLineup
	Events  []GameEvent
}

type GameListFilter struct {
	Date     string
	From     string
	To       string
	Opponent string
	Final    *bool
	Result   string
	Limit    int
	Offset   int
}

type EventWriteResult struct {
	Inserted   int  `json:"inserted"`
	Updated    int  `json:"updated"`
	Idempotent bool `json:"idempotent"`
}

type GameAnalysisResult struct {
	Analysis    GameAnalysis
	Summaries   []PlayerPerformanceSummary
	Batting     []PlayerBattingStats
	Baserunning []PlayerBaserunningStats
	Pitching    []PlayerPitchingStats
	Fielding    []PlayerFieldingStats
	DataGaps    []AnalysisDataGap
}

type GameAnalysis struct {
	ID              int64
	GameID          int64
	Date            string
	Opponent        string
	IsFinal         bool
	Result          GameResult
	OwnRuns         int
	OpponentRuns    int
	PlayersAnalyzed int
	GeneratedAt     string
	UpdatedAt       string
}

type PlayerPerformanceSummary struct {
	ID                   int64
	GameID               int64
	TeamID               int64
	PlayerID             int64
	PlayerKey            string
	Team                 string
	Player               string
	BattingOrder         *int
	Positions            string
	BattingAvailable     bool
	BaserunningAvailable bool
	PitchingAvailable    bool
	FieldingAvailable    bool
	Highlight            string
	Risk                 string
}

type PlayerBattingStats struct {
	ID                 int64
	GameID             int64
	TeamID             int64
	PlayerID           int64
	PlayerKey          string
	Team               string
	Player             string
	PA                 int
	AtBats             int
	Hits               int
	Singles            int
	Doubles            int
	Triples            int
	Homeruns           int
	Walks              int
	HitByPitch         int
	Strikeouts         int
	ReachedOnError     int
	RunsBattedIn       int
	TotalBases         int
	BattingAverage     float64
	OnBasePercentage   float64
	SluggingPercentage float64
	OPS                float64
}

type PlayerBaserunningStats struct {
	ID                   int64
	GameID               int64
	TeamID               int64
	PlayerID             int64
	PlayerKey            string
	Team                 string
	Player               string
	Runs                 int
	StolenBases          int
	CaughtStealing       int
	StolenBaseAttempts   int
	StolenBasePercentage float64
	ExtraBasesTaken      int
	BaserunningOuts      int
}

type PlayerPitchingStats struct {
	ID                 int64
	GameID             int64
	TeamID             int64
	PlayerID           int64
	PlayerKey          string
	Team               string
	Player             string
	OutsRecorded       int
	InningsPitched     float64
	BattersFaced       int
	HitsAllowed        int
	WalksAllowed       int
	Strikeouts         int
	HomerunsAllowed    int
	RunsAllowed        int
	EarnedRuns         int
	RA9                float64
	ERA                *float64
	WHIP               float64
	StrikeoutWalkRatio *float64
	WildPitches        int
	Balks              int
	Pickoffs           int
	HitBatters         int
}

type PlayerFieldingStats struct {
	ID                 int64
	GameID             int64
	TeamID             int64
	PlayerID           int64
	PlayerKey          string
	Team               string
	Player             string
	Positions          string
	Putouts            int
	Assists            int
	Errors             int
	TotalChances       int
	FieldingPercentage float64
	DoublePlays        int
	PassedBalls        int
	OutfieldAssists    int
}

type AnalysisDataGap struct {
	ID      int64
	GameID  int64
	Scope   string
	Message string
}

type GameAnalysisListItem struct {
	GameID          int64
	Date            string
	Opponent        string
	OwnRuns         int
	OpponentRuns    int
	Result          GameResult
	IsFinal         bool
	PlayersAnalyzed int
	GeneratedAt     string
	UpdatedAt       string
}
