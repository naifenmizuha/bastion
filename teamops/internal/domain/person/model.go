package person

type AnalysisResult struct {
	Analysis    Analysis
	Summary     PerformanceSummary
	Batting     BattingStats
	Baserunning BaserunningStats
	Pitching    PitchingStats
	Fielding    FieldingStats
	DataGaps    []AnalysisDataGap
}

type Analysis struct {
	Name          string
	SpanFrom      string
	SpanTo        string
	GamesInSpan   int
	GamesAnalyzed int
	OwnWins       int
	OwnLosses     int
	OwnTies       int
	ComputedAt    string
}

type PerformanceSummary struct {
	Positions            string
	GamesBatting         int
	GamesBaserunning     int
	GamesPitching        int
	GamesFielding        int
	BattingAvailable     bool
	BaserunningAvailable bool
	PitchingAvailable    bool
	FieldingAvailable    bool
	Highlight            string
	Risk                 string
}

type BattingStats struct {
	Games              int
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

type BaserunningStats struct {
	Games                int
	Runs                 int
	StolenBases          int
	CaughtStealing       int
	StolenBaseAttempts   int
	StolenBasePercentage float64
	ExtraBasesTaken      int
	BaserunningOuts      int
}

type PitchingStats struct {
	Games              int
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

type FieldingStats struct {
	Games              int
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
	Scope   string
	Message string
}
