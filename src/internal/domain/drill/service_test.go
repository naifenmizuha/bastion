package drill

import (
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

func TestServiceApproveRecommendationUpdatesStatus(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{"教练王": true}}
	service := NewService(repo)

	if err := service.ApproveRecommendation(1, "教练王"); err != nil {
		t.Fatalf("ApproveRecommendation failed: %v", err)
	}
	if repo.reviewedID != 1 || repo.reviewedStatus != StatusApproved || repo.reviewedBy != "教练王" {
		t.Fatalf("unexpected review call: id=%d status=%d reviewer=%q", repo.reviewedID, repo.reviewedStatus, repo.reviewedBy)
	}
}

func TestServiceRejectRecommendationUpdatesStatus(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{"教练王": true}}
	service := NewService(repo)

	if err := service.RejectRecommendation(2, "教练王"); err != nil {
		t.Fatalf("RejectRecommendation failed: %v", err)
	}
	if repo.reviewedID != 2 || repo.reviewedStatus != StatusRejected || repo.reviewedBy != "教练王" {
		t.Fatalf("unexpected review call: id=%d status=%d reviewer=%q", repo.reviewedID, repo.reviewedStatus, repo.reviewedBy)
	}
}

func TestServiceReviewRecommendationAllowsEmptyReviewer(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	if err := service.ApproveRecommendation(1, "  "); err != nil {
		t.Fatalf("ApproveRecommendation with empty reviewer failed: %v", err)
	}
	if repo.reviewedBy != "" {
		t.Fatalf("expected empty reviewer, got %q", repo.reviewedBy)
	}
	if repo.playerExistsCalled {
		t.Fatal("expected PlayerExists to be skipped for empty reviewer")
	}
}

func TestServiceReviewRecommendationRejectsUnknownReviewer(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{}}
	service := NewService(repo)

	err := service.ApproveRecommendation(1, "陌生人")
	if err == nil {
		t.Fatal("expected unknown reviewer to fail")
	}
	if !strings.Contains(err.Error(), "player not found: 陌生人") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServiceReviewRecommendationRejectsNonPositiveID(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{"教练王": true}}
	service := NewService(repo)

	err := service.ApproveRecommendation(0, "教练王")
	if err == nil {
		t.Fatal("expected id=0 to fail")
	}
	if !strings.Contains(err.Error(), "drill recommendation not found: 0") {
		t.Fatalf("unexpected error: %v", err)
	}
}

type fakeRepo struct {
	created            Recommendation
	listFilter         ListFilter
	existingPlayers    map[string]bool
	playerExistsCalled bool
	reviewedID         int64
	reviewedStatus     RecommendationStatus
	reviewedBy         string
}

func (r *fakeRepo) PlayerExists(name string) (bool, error) {
	r.playerExistsCalled = true
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

func (r *fakeRepo) ReviewRecommendation(id int64, status RecommendationStatus, reviewer string) error {
	r.reviewedID = id
	r.reviewedStatus = status
	r.reviewedBy = reviewer
	return nil
}
