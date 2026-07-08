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
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	URL           string    `json:"url"`
	Reason        string    `json:"reason"`
	Type          DrillType `json:"type"`
	Summary       string    `json:"summary"`
	IsApproved    bool      `json:"is_approved"`
	ReviewedBy    string    `json:"reviewed_by"`
	ReviewSummary string    `json:"review_summary"`
	ReviewNote    string    `json:"review_note"`
	ReviewedAt    string    `json:"reviewed_at"`
	CreatedAt     string    `json:"created_at"`
}

type ListFilter struct {
	Name   string
	Type   *DrillType
	Status *ReviewStatus
	ID     *int64
}

type ReviewStatus int

const (
	ReviewStatusPending ReviewStatus = iota
	ReviewStatusApproved
	ReviewStatusRejected
)

// ReviewStatus 根据审核时间与批准标记推导推荐的当前审核状态。
func (r Recommendation) ReviewStatus() ReviewStatus {
	if r.ReviewedAt == "" {
		return ReviewStatusPending
	}
	if r.IsApproved {
		return ReviewStatusApproved
	}
	return ReviewStatusRejected
}
