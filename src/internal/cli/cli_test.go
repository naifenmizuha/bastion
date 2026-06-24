package cli

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alecthomas/kong"
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

func TestHelpTextDescribesStringChoices(t *testing.T) {
	tests := []struct {
		name      string
		args      []string
		wantParts []string
	}{
		{
			name: "player add",
			args: []string{"player", "add", "-h"},
			wantParts: []string{
				"Batting hand(s): left,right.",
				"Throwing hand(s): left,right.",
				"Positions: pitcher,catcher,infield,outfield.",
			},
		},
		{
			name: "report write",
			args: []string{"report", "write", "-h"},
			wantParts: []string{
				"Training date, formatted as YYYY-MM-DD.",
				"Training content; cannot be empty.",
				"Training reflection; cannot be empty.",
			},
		},
		{
			name: "game write",
			args: []string{"game", "write", "-h"},
			wantParts: []string{
				"Own batting side: top,bottom.",
				"JSON array of lineup records.",
				"team: own,opponent.",
				"JSON array of plate appearance records.",
				"event_type:",
				"other,single,double,triple,homerun,walk,strikeout,groundout,flyout,error,steal.",
			},
		},
		{
			name: "game lineup add",
			args: []string{"game", "lineup", "add", "-h"},
			wantParts: []string{
				"Team: own,opponent.",
				"Batting order, 1-9; omit for substitute or unknown.",
				"Starting position: P,C,1B,2B,3B,SS,LF,CF,RF.",
			},
		},
		{
			name: "game event add",
			args: []string{"game", "event", "add", "-h"},
			wantParts: []string{
				"Half inning: top,bottom.",
				"Event type:",
				"other,single,double,triple,homerun,walk,strikeout,groundout,flyout,error,steal.",
				"Outs after the event: 0, 1, or 2.",
				"Base state before the event: 0-7.",
				"0 empty, 1",
				"first, 2 second, 4 third; combine by addition.",
			},
		},
		{
			name: "game list",
			args: []string{"game", "list", "-h"},
			wantParts: []string{
				"Filter games by date, formatted as YYYY-MM-DD.",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := runHelp(tt.args...)
			if err != nil {
				t.Fatalf("help command failed: %v", err)
			}
			for _, want := range tt.wantParts {
				if !strings.Contains(out, want) {
					t.Fatalf("help output missing %q: %q", want, out)
				}
			}
		})
	}
}

func TestGameWriteReadAndList(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "game", "write",
		"--date", "2026-06-24",
		"--start-time", "19:30",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--own-score", "5",
		"--opponent-score", "3",
		"--raw", "6月24日对海港队，先攻，5:3获胜",
		"--lineup-json", `[{"team":"own","player":"张三","batting_order":1,"starting_position":"P"}]`,
		"--events-json", `[{"inning":1,"half":"top","batter":"张三","pitcher":"李四","event_type":"single","pitch_sequence":"B,S,X","outs":0,"base_state":0,"runs_scored":0,"description":"张三中前安打"}]`,
	)
	if err != nil {
		t.Fatalf("game write failed: %v", err)
	}
	if !strings.Contains(out, "game saved: 1") {
		t.Fatalf("unexpected write output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "read", "--id", "1")
	if err != nil {
		t.Fatalf("game read failed: %v", err)
	}
	wantParts := []string{
		"date: 2026-06-24",
		"opponent: 海港队",
		"own_score: 5",
		"opponent_score: 3",
		"is_final: true",
		"batting_side: top",
		"team: own",
		"starting_position: P",
		"half: top",
		"event_type: single",
		"player: 张三",
		"description: 张三中前安打",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("read output missing %q: %q", want, out)
		}
	}

	out, err = runCommand(dbPath, "game", "list", "--date", "2026-06-24")
	if err != nil {
		t.Fatalf("game list failed: %v", err)
	}
	if !strings.Contains(out, "id: 1 date: 2026-06-24") || !strings.Contains(out, "batting_side: top") || !strings.Contains(out, "score: 5-3") {
		t.Fatalf("unexpected list output: %q", out)
	}
}

func TestGameCreateAppendAndSetScore(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "game", "create",
		"--date", "2026-06-24",
		"--start-time", "19:30",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--raw", "6月24日对海港队",
	)
	if err != nil {
		t.Fatalf("game create failed: %v", err)
	}
	if !strings.Contains(out, "game created: 1") {
		t.Fatalf("unexpected create output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "1",
		"--team", "OWN",
		"--player", "张三",
		"--batting-order", "1",
		"--starting-position", "p",
	)
	if err != nil {
		t.Fatalf("lineup add failed: %v", err)
	}
	if !strings.Contains(out, "lineup added: 1") {
		t.Fatalf("unexpected lineup output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "event", "add",
		"--game-id", "1",
		"--inning", "1",
		"--half", "TOP",
		"--batter", "张三",
		"--pitcher", "李四",
		"--event-type", "SINGLE",
		"--pitch-sequence", "B,S,X",
		"--outs", "0",
		"--base-state", "0",
		"--runs-scored", "0",
		"--description", "张三中前安打",
	)
	if err != nil {
		t.Fatalf("event add failed: %v", err)
	}
	if !strings.Contains(out, "event added: 1") {
		t.Fatalf("unexpected event output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "score", "set",
		"--game-id", "1",
		"--own-score", "5",
		"--opponent-score", "3",
	)
	if err != nil {
		t.Fatalf("score set failed: %v", err)
	}
	if !strings.Contains(out, "score saved: 1") {
		t.Fatalf("unexpected score output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "read", "--id", "1")
	if err != nil {
		t.Fatalf("game read failed: %v", err)
	}
	wantParts := []string{
		"is_final: true",
		"own_score: 5",
		"opponent_score: 3",
		"team: own",
		"starting_position: P",
		"half: top",
		"event_type: single",
		"player: 张三",
		"description: 张三中前安打",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("read output missing %q: %q", want, out)
		}
	}
}

func TestGameCommandsRejectInvalidInput(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "game", "create",
		"--date", "2026-6-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--raw", "raw",
	)
	if err == nil {
		t.Fatal("expected invalid date to fail")
	}
	if !strings.Contains(err.Error(), "expected YYYY-MM-DD") {
		t.Fatalf("unexpected invalid date error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "create",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "away",
		"--raw", "raw",
	)
	if err == nil {
		t.Fatal("expected invalid batting side to fail")
	}
	if !strings.Contains(err.Error(), `invalid --batting-side "away"`) {
		t.Fatalf("unexpected invalid batting side error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "999",
		"--team", "own",
		"--player", "张三",
	)
	if err == nil {
		t.Fatal("expected missing game to fail")
	}
	if !strings.Contains(err.Error(), "game not found: 999") {
		t.Fatalf("unexpected missing game error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "1",
		"--team", "home",
		"--player", "张三",
	)
	if err == nil {
		t.Fatal("expected invalid team to fail")
	}
	if !strings.Contains(err.Error(), `invalid --team "home"`) {
		t.Fatalf("unexpected invalid team error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "1",
		"--team", "own",
		"--player", "张三",
		"--starting-position", "DH",
	)
	if err == nil {
		t.Fatal("expected invalid starting position to fail")
	}
	if !strings.Contains(err.Error(), `invalid --starting-position "DH"`) {
		t.Fatalf("unexpected invalid starting position error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "write",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--own-score", "0",
		"--opponent-score", "0",
		"--raw", "raw",
		"--events-json", `[{"inning":1,"half":"middle","batter":"张三","event_type":"single","outs":0,"base_state":0,"runs_scored":0,"description":"bad"}]`,
	)
	if err == nil {
		t.Fatal("expected invalid half to fail")
	}
	if !strings.Contains(err.Error(), "invalid --half") {
		t.Fatalf("unexpected invalid half error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "write",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--own-score", "0",
		"--opponent-score", "0",
		"--raw", "raw",
		"--lineup-json", `[{"team":"home","player":"张三"}]`,
	)
	if err == nil {
		t.Fatal("expected invalid JSON enum to fail")
	}
	if !strings.Contains(err.Error(), "invalid --lineup-json item 1") || !strings.Contains(err.Error(), "invalid --team") {
		t.Fatalf("unexpected invalid JSON enum error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "event", "add",
		"--game-id", "1",
		"--inning", "1",
		"--half", "top",
		"--batter", "张三",
		"--event-type", "hit",
		"--outs", "0",
		"--base-state", "0",
		"--description", "bad",
	)
	if err == nil {
		t.Fatal("expected invalid event type to fail")
	}
	if !strings.Contains(err.Error(), `invalid --event-type "hit"`) {
		t.Fatalf("unexpected invalid event type error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "event", "add",
		"--game-id", "1",
		"--inning", "1",
		"--half", "top",
		"--batter", "张三",
		"--event-type", "single",
		"--outs", "3",
		"--base-state", "0",
		"--description", "bad",
	)
	if err == nil {
		t.Fatal("expected invalid outs to fail")
	}
	if !strings.Contains(err.Error(), "invalid --outs") {
		t.Fatalf("unexpected invalid outs error: %v", err)
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

type helpExit struct {
	code int
}

func runHelp(args ...string) (output string, err error) {
	var app CLI
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	parser := kong.Must(
		&app,
		kong.Name("bastion"),
		kong.Description("Baseball player self-training registration CLI."),
		kong.Writers(&stdout, &stderr),
		kong.Exit(func(code int) {
			panic(helpExit{code: code})
		}),
	)

	defer func() {
		recovered := recover()
		if recovered == nil {
			output = stdout.String() + stderr.String()
			return
		}
		exit, ok := recovered.(helpExit)
		if !ok {
			panic(recovered)
		}
		output = stdout.String() + stderr.String()
		if exit.code != 0 {
			err = fmt.Errorf("help exited with code %d", exit.code)
		}
	}()

	_, err = parser.Parse(args)
	return stdout.String() + stderr.String(), err
}
