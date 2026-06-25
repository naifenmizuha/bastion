package sqlite

import (
	"database/sql"
	"path/filepath"
	"testing"

	"bastion/internal/domain/drill"

	_ "github.com/mattn/go-sqlite3"
)

func TestStoreDrillRecommendationCreateAndList(t *testing.T) {
	store := newTestStore(t)

	infield := drill.DrillTypeInfield
	pitching := drill.DrillTypePitching

	id1, err := store.CreateRecommendation(drill.Recommendation{
		Name: "张三", URL: "https://example.com/a", Reason: "步伐", Type: drill.DrillTypeInfield, Summary: "内野扑球",
	})
	if err != nil {
		t.Fatalf("CreateRecommendation failed: %v", err)
	}
	id2, err := store.CreateRecommendation(drill.Recommendation{
		Name: "李四", URL: "https://example.com/b", Reason: "发力", Type: drill.DrillTypePitching, Summary: "投球发力",
	})
	if err != nil {
		t.Fatalf("CreateRecommendation failed: %v", err)
	}
	if id1 == 0 || id2 == 0 {
		t.Fatalf("expected non-zero ids, got %d %d", id1, id2)
	}

	all, err := store.ListRecommendations(drill.ListFilter{})
	if err != nil {
		t.Fatalf("ListRecommendations failed: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 recommendations, got %d", len(all))
	}
	if all[0].ID != id2 || all[1].ID != id1 {
		t.Fatalf("expected newest first (id DESC), got %d %d", all[0].ID, all[1].ID)
	}
	if all[0].Type != drill.DrillTypePitching || all[0].Name != "李四" {
		t.Fatalf("unexpected first row: %+v", all[0])
	}
	if all[0].Status != drill.StatusPending || all[0].ReviewedBy != "" || all[0].ReviewedAt != "" {
		t.Fatalf("expected pending with no reviewer, got %+v", all[0])
	}

	byName, err := store.ListRecommendations(drill.ListFilter{Name: "张三"})
	if err != nil {
		t.Fatalf("ListRecommendations by name failed: %v", err)
	}
	if len(byName) != 1 || byName[0].Name != "张三" {
		t.Fatalf("expected 1 recommendation for 张三, got %+v", byName)
	}

	byType, err := store.ListRecommendations(drill.ListFilter{Type: &pitching})
	if err != nil {
		t.Fatalf("ListRecommendations by type failed: %v", err)
	}
	if len(byType) != 1 || byType[0].Type != drill.DrillTypePitching {
		t.Fatalf("expected 1 pitching recommendation, got %+v", byType)
	}

	combined, err := store.ListRecommendations(drill.ListFilter{Name: "张三", Type: &infield})
	if err != nil {
		t.Fatalf("ListRecommendations combined failed: %v", err)
	}
	if len(combined) != 1 || combined[0].Name != "张三" || combined[0].Type != drill.DrillTypeInfield {
		t.Fatalf("expected 1 combined recommendation, got %+v", combined)
	}

	none, err := store.ListRecommendations(drill.ListFilter{Name: "张三", Type: &pitching})
	if err != nil {
		t.Fatalf("ListRecommendations none failed: %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("expected 0 recommendations for conflicting filter, got %d", len(none))
	}
}

func TestStoreDrillRecommendationReviewAndStatusFilter(t *testing.T) {
	store := newTestStore(t)

	pending := drill.StatusPending
	approved := drill.StatusApproved
	rejected := drill.StatusRejected

	id1, err := store.CreateRecommendation(drill.Recommendation{
		Name: "张三", URL: "https://example.com/a", Reason: "步伐", Type: drill.DrillTypeInfield, Summary: "内野扑球",
	})
	if err != nil {
		t.Fatalf("CreateRecommendation 1 failed: %v", err)
	}
	id2, err := store.CreateRecommendation(drill.Recommendation{
		Name: "李四", URL: "https://example.com/b", Reason: "发力", Type: drill.DrillTypePitching, Summary: "投球发力",
	})
	if err != nil {
		t.Fatalf("CreateRecommendation 2 failed: %v", err)
	}

	// 审批 id1 通过、id2 驳回
	if err := store.ReviewRecommendation(id1, drill.StatusApproved, "教练王"); err != nil {
		t.Fatalf("ReviewRecommendation approve failed: %v", err)
	}
	if err := store.ReviewRecommendation(id2, drill.StatusRejected, ""); err != nil {
		t.Fatalf("ReviewRecommendation reject failed: %v", err)
	}

	// 按状态过滤
	approvedList, err := store.ListRecommendations(drill.ListFilter{Status: &approved})
	if err != nil {
		t.Fatalf("ListRecommendations approved failed: %v", err)
	}
	if len(approvedList) != 1 || approvedList[0].ID != id1 || approvedList[0].Status != drill.StatusApproved {
		t.Fatalf("expected only id1 approved, got %+v", approvedList)
	}
	if approvedList[0].ReviewedBy != "教练王" || approvedList[0].ReviewedAt == "" {
		t.Fatalf("expected reviewer set, got %+v", approvedList[0])
	}

	rejectedList, err := store.ListRecommendations(drill.ListFilter{Status: &rejected})
	if err != nil {
		t.Fatalf("ListRecommendations rejected failed: %v", err)
	}
	if len(rejectedList) != 1 || rejectedList[0].ID != id2 || rejectedList[0].Status != drill.StatusRejected {
		t.Fatalf("expected only id2 rejected, got %+v", rejectedList)
	}
	if rejectedList[0].ReviewedBy != "" || rejectedList[0].ReviewedAt == "" {
		t.Fatalf("expected empty reviewer but set reviewed_at, got %+v", rejectedList[0])
	}

	pendingList, err := store.ListRecommendations(drill.ListFilter{Status: &pending})
	if err != nil {
		t.Fatalf("ListRecommendations pending failed: %v", err)
	}
	if len(pendingList) != 0 {
		t.Fatalf("expected 0 pending, got %d", len(pendingList))
	}

	// 反复审批覆盖旧值
	if err := store.ReviewRecommendation(id1, drill.StatusRejected, "教练李"); err != nil {
		t.Fatalf("ReviewRecommendation re-review failed: %v", err)
	}
	approvedList, _ = store.ListRecommendations(drill.ListFilter{Status: &approved})
	if len(approvedList) != 0 {
		t.Fatalf("expected id1 no longer approved after re-review, got %+v", approvedList)
	}
	rejectedList, _ = store.ListRecommendations(drill.ListFilter{Status: &rejected})
	if len(rejectedList) != 2 {
		t.Fatalf("expected 2 rejected after re-review, got %d", len(rejectedList))
	}
	for _, r := range rejectedList {
		if r.ID == id1 && r.ReviewedBy != "教练李" {
			t.Fatalf("expected id1 reviewer overwritten to 教练李, got %q", r.ReviewedBy)
		}
	}
}

func TestStoreDrillRecommendationReviewNotFound(t *testing.T) {
	store := newTestStore(t)

	err := store.ReviewRecommendation(999, drill.StatusApproved, "教练王")
	if err == nil {
		t.Fatal("expected missing recommendation to fail")
	}
	if err.Error() != "drill recommendation not found: 999" {
		t.Fatalf("unexpected error: %v", err)
	}
}

// 旧库（只有原始六列）升级后，原有推荐视为 pending，且可被审批。
func TestStoreDrillRecommendationMigrationFromOldSchema(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open old db: %v", err)
	}
	// 模拟旧库结构：仅有原始六列的 drill_recommendations 表。
	if _, err := db.Exec(`
CREATE TABLE drill_recommendations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	url TEXT NOT NULL,
	reason TEXT NOT NULL,
	type INTEGER NOT NULL,
	summary TEXT NOT NULL,
	created_at TEXT NOT NULL
);`); err != nil {
		t.Fatalf("create old table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO drill_recommendations (name, url, reason, type, summary, created_at) VALUES ('张三', 'https://example.com/a', '步伐', 0, '内野扑球', '2026-06-25T07:00:00Z')`); err != nil {
		t.Fatalf("insert old row: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close old db: %v", err)
	}

	// 重新打开并触发升级。
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	})
	if err := store.Init(); err != nil {
		t.Fatalf("Init migration failed: %v", err)
	}

	// 老数据应被视为 pending，且审批字段为空。
	recs, err := store.ListRecommendations(drill.ListFilter{})
	if err != nil {
		t.Fatalf("ListRecommendations failed: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("expected 1 recommendation, got %d", len(recs))
	}
	if recs[0].Status != drill.StatusPending || recs[0].ReviewedBy != "" || recs[0].ReviewedAt != "" {
		t.Fatalf("expected pending with empty review fields, got %+v", recs[0])
	}

	// 升级后可审批。
	if err := store.ReviewRecommendation(1, drill.StatusApproved, "教练王"); err != nil {
		t.Fatalf("ReviewRecommendation after migration failed: %v", err)
	}
	approved := drill.StatusApproved
	recs, err = store.ListRecommendations(drill.ListFilter{Status: &approved})
	if err != nil {
		t.Fatalf("ListRecommendations approved failed: %v", err)
	}
	if len(recs) != 1 || recs[0].ReviewedBy != "教练王" || recs[0].ReviewedAt == "" {
		t.Fatalf("expected approved recommendation after migration, got %+v", recs)
	}

	// 再次 Init() 应保持幂等。
	if err := store.Init(); err != nil {
		t.Fatalf("re-Init failed: %v", err)
	}
}
