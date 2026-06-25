package drill

import (
	"errors"
	"strings"
	"testing"
)

func TestServiceWriteRecommendationRequiresExistingPlayer(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	_, err := service.WriteRecommendation("不存在", "https://example.com", "步伐好", DrillTypeInfield, "讲解内野扑球")
	if err == nil {
		t.Fatal("expected missing player to fail")
	}
	if !strings.Contains(err.Error(), "player not found: 不存在") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServiceWriteRecommendationNormalizesFields(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{"张三": true}}
	service := NewService(repo)

	id, err := service.WriteRecommendation(" 张三 ", " https://example.com/v ", " 步伐好 ", DrillTypeInfield, " 讲解内野扑球 ")
	if err != nil {
		t.Fatalf("WriteRecommendation failed: %v", err)
	}
	if id != 1 {
		t.Fatalf("unexpected id: %d", id)
	}
	got := repo.created
	if got.Name != "张三" || got.URL != "https://example.com/v" || got.Reason != "步伐好" || got.Summary != "讲解内野扑球" || got.Type != DrillTypeInfield {
		t.Fatalf("unexpected recommendation: %+v", got)
	}
}

func TestServiceWriteRecommendationRejectsEmptyFields(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{"张三": true}}
	service := NewService(repo)

	cases := []struct {
		name    string
		url     string
		reason  string
		summary string
		want    string
	}{
		{"", "u", "r", "s", "--name cannot be empty"},
		{"张三", "", "r", "s", "--url cannot be empty"},
		{"张三", "u", "", "s", "--reason cannot be empty"},
		{"张三", "u", "r", "", "--summary cannot be empty"},
	}
	for _, c := range cases {
		_, err := service.WriteRecommendation(c.name, c.url, c.reason, DrillTypeInfield, c.summary)
		if err == nil {
			t.Fatalf("expected empty %q to fail", c.want)
		}
		if !strings.Contains(err.Error(), c.want) {
			t.Fatalf("unexpected error for %q: %v", c.want, err)
		}
	}
}

func TestServiceWriteRecommendationRejectsInvalidType(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{"张三": true}}
	service := NewService(repo)

	_, err := service.WriteRecommendation("张三", "u", "r", DrillType(-1), "s")
	if err == nil {
		t.Fatal("expected invalid type to fail")
	}
	if !strings.Contains(err.Error(), "invalid --type") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServiceListRecommendationsTrimsNameFilter(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	_, err := service.ListRecommendations(ListFilter{Name: "  张三  "})
	if err != nil {
		t.Fatalf("ListRecommendations failed: %v", err)
	}
	if repo.listFilter.Name != "张三" {
		t.Fatalf("expected trimmed name filter, got %q", repo.listFilter.Name)
	}
}

func TestServiceListRecommendationsValidatesReviewStatus(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)
	invalid := ReviewStatus(-1)

	_, err := service.ListRecommendations(ListFilter{Status: &invalid})
	if err == nil {
		t.Fatal("expected invalid status to fail")
	}
	if !strings.Contains(err.Error(), "invalid --status") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServiceApproveRecommendationNormalizesFields(t *testing.T) {
	repo := &fakeRepo{recommendations: map[int64]Recommendation{1: {ID: 1}}}
	service := NewService(repo)

	if err := service.ApproveRecommendation(1, " 王教练 ", " 适合内野步伐 ", " 下周训练使用 "); err != nil {
		t.Fatalf("ApproveRecommendation failed: %v", err)
	}
	if repo.reviewID != 1 || !repo.reviewApproved || repo.reviewedBy != "王教练" || repo.reviewSummary != "适合内野步伐" || repo.reviewNote != "下周训练使用" {
		t.Fatalf("unexpected review: id=%d approved=%v by=%q summary=%q note=%q", repo.reviewID, repo.reviewApproved, repo.reviewedBy, repo.reviewSummary, repo.reviewNote)
	}
}

func TestServiceRejectRecommendationRejectsEmptyReason(t *testing.T) {
	repo := &fakeRepo{recommendations: map[int64]Recommendation{1: {ID: 1}}}
	service := NewService(repo)

	err := service.RejectRecommendation(1, "王教练", "摘要", " ")
	if err == nil {
		t.Fatal("expected empty reason to fail")
	}
	if !strings.Contains(err.Error(), "--reason cannot be empty") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServiceGetTrainingRequiresApprovedRecommendation(t *testing.T) {
	repo := &fakeRepo{recommendations: map[int64]Recommendation{
		1: {ID: 1, IsApproved: true},
		2: {ID: 2, IsApproved: false},
	}}
	service := NewService(repo)

	if _, err := service.GetTraining(1); err != nil {
		t.Fatalf("GetTraining approved failed: %v", err)
	}
	_, err := service.GetTraining(2)
	if err == nil {
		t.Fatal("expected unapproved training to fail")
	}
	if !strings.Contains(err.Error(), "drill training not found: 2") {
		t.Fatalf("unexpected error: %v", err)
	}
}

type fakeRepo struct {
	created         Recommendation
	listFilter      ListFilter
	existingPlayers map[string]bool
	recommendations map[int64]Recommendation
	reviewID        int64
	reviewApproved  bool
	reviewedBy      string
	reviewSummary   string
	reviewNote      string
}

func (r *fakeRepo) PlayerExists(name string) (bool, error) {
	return r.existingPlayers[name], nil
}

func (r *fakeRepo) CreateRecommendation(rec Recommendation) (int64, error) {
	r.created = rec
	return 1, nil
}

func (r *fakeRepo) ListRecommendations(filter ListFilter) ([]Recommendation, error) {
	r.listFilter = filter
	return nil, nil
}

func (r *fakeRepo) GetRecommendation(id int64) (Recommendation, error) {
	if r.recommendations == nil {
		return Recommendation{}, nil
	}
	rec, ok := r.recommendations[id]
	if !ok {
		return Recommendation{}, errors.New("not found")
	}
	return rec, nil
}

func (r *fakeRepo) UpdateRecommendationReview(id int64, isApproved bool, reviewedBy string, reviewSummary string, reviewNote string) error {
	r.reviewID = id
	r.reviewApproved = isApproved
	r.reviewedBy = reviewedBy
	r.reviewSummary = reviewSummary
	r.reviewNote = reviewNote
	return nil
}
