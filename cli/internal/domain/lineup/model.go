package lineup

type Status int

const (
	StatusValidated Status = iota
	StatusAccepted
	StatusRejected
	StatusSuperseded
)

type EntryRole int

const (
	RoleStarter EntryRole = iota
	RoleBench
)

type PitchingRole int

const (
	PitchingRoleStarter PitchingRole = iota
	PitchingRoleReliever
)

type Starter struct {
	Player       string
	Position     int
	BattingOrder int
}

type BenchEntry struct {
	Player        string
	SuggestedRole string
}

type PitchingPlan struct {
	ID             int64
	LineupID       int64
	Player         string
	Sequence       int
	Role           PitchingRole
	PlannedInnings *int
}

type Draft struct {
	SchemaVersion string
	GameID        int64
	Strategy      string
	Starters      []Starter
	Bench         []BenchEntry
	PitchingPlan  []PitchingPlan
	Reasoning     []string
}

type Entry struct {
	ID            int64
	LineupID      int64
	Player        string
	Role          EntryRole
	BattingOrder  *int
	Position      *int
	SuggestedRole string
}

type Lineup struct {
	ID            int64
	GameID        int64
	SchemaVersion string
	Status        Status
	Strategy      string
	Reasoning     []string
	Warnings      []Issue
	CreatedAt     string
	AcceptedAt    string
	Entries       []Entry
	PitchingPlan  []PitchingPlan
}

type ListFilter struct {
	GameID int64
	Status *Status
}

type Issue struct {
	Code             string   `json:"code" toml:"code"`
	Field            string   `json:"field,omitempty" toml:"field,omitempty"`
	Player           string   `json:"player,omitempty" toml:"player,omitempty"`
	Position         string   `json:"position,omitempty" toml:"position,omitempty"`
	AllowedPositions []string `json:"allowed_positions,omitempty" toml:"allowed_positions,omitempty"`
	Message          string   `json:"message" toml:"message"`
}

type ValidationResult struct {
	Valid        bool
	GameID       int64
	StarterCount int
	BenchCount   int
	Errors       []Issue
	Warnings     []Issue
}

type AcceptResult struct {
	LineupID        int64
	GameID          int64
	GameLineupCount int
}
