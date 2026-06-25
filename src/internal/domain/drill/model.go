package drill

type DrillType int

const (
	DrillTypePitching DrillType = iota
	DrillTypeCatching
	DrillTypeHitting
	DrillTypeStrength
	DrillTypeBaserunning
	DrillTypeInfield
	DrillTypeOutfield
)

type Recommendation struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Reason    string    `json:"reason"`
	Type      DrillType `json:"type"`
	Summary   string    `json:"summary"`
	CreatedAt string    `json:"created_at"`
}

type ListFilter struct {
	Name string
	Type *DrillType
}
