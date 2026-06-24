package cli

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlayerAddAndRead(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "right",
		"--throw", "right",
		"--positions", "pitcher,infield",
	)
	if err != nil {
		t.Fatalf("player add failed: %v", err)
	}
	if !strings.Contains(out, "player added: 张三") {
		t.Fatalf("unexpected add output: %q", out)
	}

	out, err = runCommand(dbPath, "player", "read", "--name", "张三")
	if err != nil {
		t.Fatalf("player read failed: %v", err)
	}

	wantParts := []string{
		"name: 张三",
		"number: 18",
		"bat: right",
		"throw: right",
		"positions: pitcher,infield",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("read output missing %q: %q", want, out)
		}
	}
}

func TestPlayerAddRejectsDuplicateName(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "right",
		"--throw", "right",
		"--positions", "pitcher",
	)
	if err != nil {
		t.Fatalf("first player add failed: %v", err)
	}

	_, err = runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "19",
		"--bat", "left",
		"--throw", "left",
		"--positions", "outfield",
	)
	if err == nil {
		t.Fatal("expected duplicate player add to fail")
	}
	if !strings.Contains(err.Error(), "player already exists: 张三") {
		t.Fatalf("unexpected duplicate error: %v", err)
	}
}

func TestReportWriteReadAndOverwrite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	_, err := runCommand(dbPath, "report", "write",
		"--name", "张三",
		"--date", "2026-06-24",
		"--content", "挥棒训练",
		"--reflection", "节奏更稳定",
	)
	if err != nil {
		t.Fatalf("report write failed: %v", err)
	}

	_, err = runCommand(dbPath, "report", "write",
		"--name", "张三",
		"--date", "2026-06-24",
		"--content", "守备训练",
		"--reflection", "脚步更主动",
	)
	if err != nil {
		t.Fatalf("report overwrite failed: %v", err)
	}

	out, err := runCommand(dbPath, "report", "read",
		"--name", "张三",
		"--date", "2026-06-24",
	)
	if err != nil {
		t.Fatalf("report read failed: %v", err)
	}

	wantParts := []string{
		"name: 张三",
		"date: 2026-06-24",
		"content: 守备训练",
		"reflection: 脚步更主动",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("report output missing %q: %q", want, out)
		}
	}
	if strings.Contains(out, "挥棒训练") {
		t.Fatalf("report was not overwritten: %q", out)
	}
}

func TestReportWriteRequiresExistingPlayer(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "report", "write",
		"--name", "不存在",
		"--date", "2026-06-24",
		"--content", "挥棒训练",
		"--reflection", "节奏更稳定",
	)
	if err == nil {
		t.Fatal("expected report write to fail for missing player")
	}
	if !strings.Contains(err.Error(), "player not found: 不存在") {
		t.Fatalf("unexpected missing player error: %v", err)
	}
}

func TestReportRejectsInvalidDate(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	_, err := runCommand(dbPath, "report", "write",
		"--name", "张三",
		"--date", "2026-6-24",
		"--content", "挥棒训练",
		"--reflection", "节奏更稳定",
	)
	if err == nil {
		t.Fatal("expected invalid date to fail")
	}
	if !strings.Contains(err.Error(), "expected YYYY-MM-DD") {
		t.Fatalf("unexpected invalid date error: %v", err)
	}
}

func TestPlayerRejectsInvalidChoice(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "switch",
		"--throw", "right",
		"--positions", "pitcher",
	)
	if err == nil {
		t.Fatal("expected invalid hand value to fail")
	}
	if !strings.Contains(err.Error(), "invalid --bat") {
		t.Fatalf("unexpected invalid choice error: %v", err)
	}
}

func addTestPlayer(t *testing.T, dbPath string) {
	t.Helper()
	_, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "right",
		"--throw", "right",
		"--positions", "pitcher,infield",
	)
	if err != nil {
		t.Fatalf("add test player failed: %v", err)
	}
}

func runCommand(dbPath string, args ...string) (string, error) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	fullArgs := append([]string{"--db", dbPath}, args...)
	err := Run(fullArgs, &stdout, &stderr)
	if err != nil {
		return stdout.String() + stderr.String(), err
	}
	return stdout.String() + stderr.String(), nil
}
