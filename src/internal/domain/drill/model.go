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

// RecommendationStatus 表示一条推荐在审批流转中的状态。
type RecommendationStatus int

const (
	StatusPending RecommendationStatus = iota
	StatusApproved
	StatusRejected
)

type Recommendation struct {
	ID         int64                `json:"id"`
	Name       string               `json:"name"`
	URL        string               `json:"url"`
	Reason     string               `json:"reason"`
	Type       DrillType            `json:"type"`
	Summary    string               `json:"summary"`
	Status     RecommendationStatus `json:"status"`
	ReviewedBy string               `json:"reviewed_by,omitempty"`
	ReviewedAt string               `json:"reviewed_at,omitempty"`
	CreatedAt  string               `json:"created_at"`
}

type ListFilter struct {
	Name   string
	Type   *DrillType
	Status *RecommendationStatus
}
