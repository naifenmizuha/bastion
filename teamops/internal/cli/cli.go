package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"teamops/internal/domain/drill"
	"teamops/internal/domain/game"
	"teamops/internal/domain/lineup"
	"teamops/internal/domain/person"
	"teamops/internal/domain/player"
	"teamops/internal/domain/report"
	"teamops/internal/sqlite"

	"github.com/alecthomas/kong"
	"github.com/pelletier/go-toml/v2"
)

type CLI struct {
	DB       string      `help:"Path to the SQLite database." default:"bastion.db" placeholder:"PATH"`
	Format   string      `help:"Output format: json,toml,text." enum:"json,toml,text" default:"json"`
	Batch    BatchCmd    `cmd:"" help:"Run multiple registered commands from one JSON input."`
	Player   PlayerCmd   `cmd:"" help:"Manage players."`
	Report   ReportCmd   `cmd:"" help:"Manage training reports."`
	Game     GameCmd     `cmd:"" help:"Manage games."`
	Lineup   LineupCmd   `cmd:"" help:"Manage generated game lineups."`
	Drill    DrillCmd    `cmd:"" help:"Manage drill recommendations."`
	Person   PersonCmd   `cmd:"" help:"Manage person cross-period analysis."`
	Contract ContractCmd `cmd:"" help:"Print machine-readable structured input contracts."`
}

type BatchCmd struct {
	Read  BatchReadCmd  `cmd:"" help:"Run multiple read-only commands."`
	Write BatchWriteCmd `cmd:"" help:"Run multiple commands, including writes."`
}

type BatchReadCmd struct {
	Input string `required:"" help:"Path to batch JSON input, or - for stdin." placeholder:"PATH"`
}

type BatchWriteCmd struct {
	Input string `required:"" help:"Path to batch JSON input, or - for stdin." placeholder:"PATH"`
}

type PlayerCmd struct {
	Add  PlayerAddCmd  `cmd:"" help:"Add a player."`
	Read PlayerReadCmd `cmd:"" help:"Read a player by name."`
	List PlayerListCmd `cmd:"" help:"List registered players."`
}

type PlayerAddCmd struct {
	Input string `required:"" help:"Path to player JSON input, or - for stdin." placeholder:"PATH"`
}

type PlayerReadCmd struct {
	Name string `required:"" help:"Player name to read."`
}

type PlayerListCmd struct{}

type ReportCmd struct {
	Write ReportWriteCmd `cmd:"" help:"Write a training report."`
	Read  ReportReadCmd  `cmd:"" help:"Read a training report."`
}

type ReportWriteCmd struct {
	Input string `required:"" help:"Path to training report JSON input, or - for stdin." placeholder:"PATH"`
}

type ReportReadCmd struct {
	Name string `required:"" help:"Player name."`
	Date string `required:"" help:"Training date, formatted as YYYY-MM-DD."`
}

type GameCmd struct {
	Write    GameWriteCmd    `cmd:"" help:"Write a complete game."`
	Create   GameCreateCmd   `cmd:"" help:"Create a game."`
	Lineup   GameLineupCmd   `cmd:"" help:"Manage game lineups."`
	Event    GameEventCmd    `cmd:"" help:"Manage game fact events."`
	Score    GameScoreCmd    `cmd:"" help:"Manage game scores."`
	Analysis GameAnalysisCmd `cmd:"" help:"Manage game player performance analysis."`
	Read     GameReadCmd     `cmd:"" help:"Read a game by id."`
	List     GameListCmd     `cmd:"" help:"List games."`
}

type GameWriteCmd struct {
	Input string `required:"" help:"Path to complete game JSON input, or - for stdin." placeholder:"PATH"`
}

type GameCreateCmd struct {
	Input string `required:"" help:"Path to game JSON input, or - for stdin." placeholder:"PATH"`
}

type GameLineupCmd struct {
	Add GameLineupAddCmd `cmd:"" help:"Add a lineup record."`
}

type GameLineupAddCmd struct {
	Input string `required:"" help:"Path to game lineup JSON input, or - for stdin." placeholder:"PATH"`
}

type GameEventCmd struct {
	Validate GameEventValidateCmd `cmd:"" help:"Validate game fact events without saving."`
	Write    GameEventWriteCmd    `cmd:"" help:"Write game fact events."`
}

type GameEventValidateCmd struct {
	Input string `required:"" help:"Path to game event JSON input, or - for stdin." placeholder:"PATH"`
}

type GameEventWriteCmd struct {
	Input string `required:"" help:"Path to game event JSON input, or - for stdin." placeholder:"PATH"`
}

type GameScoreCmd struct {
	Set GameScoreSetCmd `cmd:"" help:"Set final score."`
}

type GameScoreSetCmd struct {
	Input string `required:"" help:"Path to game score JSON input, or - for stdin." placeholder:"PATH"`
}

type GameAnalysisCmd struct {
	Generate GameAnalysisGenerateCmd `cmd:"" help:"Generate player performance analysis."`
	Read     GameAnalysisReadCmd     `cmd:"" help:"Read generated player performance analysis."`
	List     GameAnalysisListCmd     `cmd:"" help:"List games with generated analysis."`
}

type GameAnalysisGenerateCmd struct {
	Input string `required:"" help:"Path to game analysis generation JSON input, or - for stdin." placeholder:"PATH"`
}

type GameAnalysisReadCmd struct {
	GameID int64  `required:"" help:"Game id to read generated analysis for."`
	Player string `help:"Optional player name; when set only this player's analysis is shown."`
}

type GameAnalysisListCmd struct{}

type GameReadCmd struct {
	ID int64 `required:"" help:"Game id to read."`
}

type GameListCmd struct {
	Date string `help:"Filter games by date, formatted as YYYY-MM-DD."`
}

type LineupCmd struct {
	Validate LineupValidateCmd `cmd:"" help:"Validate a generated lineup without saving it."`
	Write    LineupWriteCmd    `cmd:"" help:"Validate and save a generated lineup."`
	Read     LineupReadCmd     `cmd:"" help:"Read a generated lineup by id."`
	List     LineupListCmd     `cmd:"" help:"List generated lineups."`
	Accept   LineupAcceptCmd   `cmd:"" help:"Accept a validated lineup as the game lineup."`
	Reject   LineupRejectCmd   `cmd:"" help:"Reject a validated lineup."`
}

type LineupValidateCmd struct {
	Input string `required:"" help:"Path to lineup JSON input, or - for stdin." placeholder:"PATH"`
}

type LineupWriteCmd struct {
	Input string `required:"" help:"Path to lineup JSON input, or - for stdin." placeholder:"PATH"`
}

type LineupReadCmd struct {
	ID int64 `required:"" help:"Lineup id."`
}

type LineupListCmd struct {
	GameID int64  `help:"Optional game id."`
	Status string `help:"Optional status: validated,accepted,rejected,superseded."`
}

type LineupAcceptCmd struct {
	ID int64 `required:"" help:"Validated lineup id."`
}

type LineupRejectCmd struct {
	ID int64 `required:"" help:"Validated lineup id."`
}

type DrillCmd struct {
	Recommend DrillRecommendCmd `cmd:"" help:"Manage drill recommendations."`
	Review    DrillReviewCmd    `cmd:"" help:"Review drill recommendations."`
	Training  DrillTrainingCmd  `cmd:"" help:"Manage approved drill trainings."`
}

type DrillRecommendCmd struct {
	Write DrillWriteCmd `cmd:"" help:"Write a drill recommendation."`
	List  DrillListCmd  `cmd:"" help:"List drill recommendations."`
}

type DrillWriteCmd struct {
	Input string `required:"" help:"Path to drill recommendation JSON input, or - for stdin." placeholder:"PATH"`
}

type DrillListCmd struct {
	Name   string `help:"Filter by recommender name."`
	Type   string `help:"Filter by drill type: pitching,catching,hitting,strength,baserunning,infield,outfield."`
	Status string `help:"Filter by review status: pending,approved,rejected."`
}

type DrillReviewCmd struct {
	Approve DrillReviewApproveCmd `cmd:"" help:"Approve a drill recommendation."`
	Reject  DrillReviewRejectCmd  `cmd:"" help:"Reject a drill recommendation."`
}

type DrillReviewApproveCmd struct {
	RecommendationID int64  `required:"" help:"Drill recommendation id to approve."`
	Coach            string `required:"" help:"Reviewing coach name."`
	Summary          string `required:"" help:"Review summary."`
	Note             string `required:"" help:"Approval note."`
}

type DrillReviewRejectCmd struct {
	RecommendationID int64  `required:"" help:"Drill recommendation id to reject."`
	Coach            string `required:"" help:"Reviewing coach name."`
	Summary          string `required:"" help:"Review summary."`
	Reason           string `required:"" help:"Rejection reason."`
}

type DrillTrainingCmd struct {
	List DrillTrainingListCmd `cmd:"" help:"List approved drill trainings."`
	Read DrillTrainingReadCmd `cmd:"" help:"Read an approved drill training."`
}

type DrillTrainingListCmd struct {
	Name string `help:"Filter by recommender name."`
	Type string `help:"Filter by drill type: pitching,catching,hitting,strength,baserunning,infield,outfield."`
}

type DrillTrainingReadCmd struct {
	RecommendationID int64 `required:"" help:"Approved drill recommendation id to read."`
}

type PersonCmd struct {
	Analysis PersonAnalysisCmd `cmd:"" help:"Manage person cross-period analysis."`
}

type PersonAnalysisCmd struct {
	Read PersonAnalysisReadCmd `cmd:"" help:"Read cross-period player analysis."`
}

type PersonAnalysisReadCmd struct {
	Name string `required:"" help:"Player name; must be a registered player."`
	From string `required:"" help:"Span start date, formatted as YYYY-MM-DD, inclusive."`
	To   string `required:"" help:"Span end date, formatted as YYYY-MM-DD, inclusive; must be >= --from."`
}

type Context struct {
	DB            string
	PlayerService *player.Service
	ReportService *report.Service
	GameService   *game.Service
	LineupService *lineup.Service
	DrillService  *drill.Service
	PersonService *person.Service
	Out           io.Writer
	In            io.Reader
	Format        string
}

// Run 使用进程标准输入启动 CLI。
func Run(args []string, stdout io.Writer, stderr io.Writer) error {
	return RunWithIO(args, os.Stdin, stdout, stderr)
}

// RunWithIO 解析命令、初始化服务，并以注入的输入输出执行命令。
func RunWithIO(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) error {
	var app CLI
	parser := kong.Must(
		&app,
		kong.Name("teamops"),
		kong.Description("Baseball player self-training registration CLI."),
		kong.Writers(stdout, stderr),
	)

	ctx, err := parser.Parse(args)
	if err != nil {
		writeError(stdout, app.Format, err)
		return err
	}

	if ctx.Command() == "contract" {
		return ctx.Run(&Context{
			DB:     app.DB,
			Out:    stdout,
			In:     stdin,
			Format: app.Format,
		})
	}

	store, err := sqlite.Open(app.DB)
	if err != nil {
		writeError(stdout, app.Format, err)
		return err
	}
	defer store.Close()

	if err := store.Init(); err != nil {
		writeError(stdout, app.Format, err)
		return err
	}

	runErr := ctx.Run(&Context{
		DB:            app.DB,
		PlayerService: player.NewService(store),
		ReportService: report.NewService(store),
		GameService:   game.NewService(store),
		LineupService: lineup.NewService(store),
		DrillService:  drill.NewService(store),
		PersonService: person.NewService(store),
		Out:           stdout,
		In:            stdin,
		Format:        app.Format,
	})
	if runErr != nil {
		writeError(stdout, app.Format, runErr)
	}
	return runErr
}

// Run executes a batch containing only read-only commands.
func (cmd *BatchReadCmd) Run(ctx *Context) error {
	return runBatch(ctx, cmd.Input, "read", []string{"batch", "read"})
}

// Run executes a batch that may include writes.
func (cmd *BatchWriteCmd) Run(ctx *Context) error {
	return runBatch(ctx, cmd.Input, "write", []string{"batch", "write"})
}

// Run 读取球员输入并调用球员创建服务。
func (cmd *PlayerAddCmd) Run(ctx *Context) error {
	var input playerAddInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"player", "add"}); err != nil {
		return err
	}
	player, err := ctx.PlayerService.AddPlayer(input.Name, input.Number, input.Bat, input.Throw, input.Positions)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "player", "name": player.Name}, fmt.Sprintf("player added: %s\n", player.Name))
}

// Run 按名称读取并输出球员资料。
func (cmd *PlayerReadCmd) Run(ctx *Context) error {
	player, err := ctx.PlayerService.GetPlayer(cmd.Name)
	if err != nil {
		return err
	}
	return printPlayer(ctx, player)
}

// Run 列出全部已登记球员。
func (cmd *PlayerListCmd) Run(ctx *Context) error {
	players, err := ctx.PlayerService.ListPlayers()
	if err != nil {
		return err
	}
	return printPlayerList(ctx, players)
}

// Run 读取训练报告输入并保存。
func (cmd *ReportWriteCmd) Run(ctx *Context) error {
	var input reportWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"report", "write"}); err != nil {
		return err
	}
	report, err := ctx.ReportService.WriteReport(input.Name, input.Date, input.Content, input.Reflection)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "report", "name": report.Name, "date": report.Date}, fmt.Sprintf("report saved: %s %s\n", report.Name, report.Date))
}

// Run 按球员和日期读取训练报告。
func (cmd *ReportReadCmd) Run(ctx *Context) error {
	report, err := ctx.ReportService.GetReport(cmd.Name, cmd.Date)
	if err != nil {
		return err
	}
	return printReport(ctx, report)
}

// Run 读取完整比赛输入并一次性写入。
func (cmd *GameWriteCmd) Run(ctx *Context) error {
	var input gameWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"game", "write"}); err != nil {
		return err
	}
	battingSide, err := parseBattingSide(input.BattingSide)
	if err != nil {
		return err
	}
	lineups, err := lineupsFromJSON(input.Lineups)
	if err != nil {
		return err
	}
	events, err := eventsFromJSON(input.Events)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.WriteGame(
		input.Date,
		input.StartTime,
		input.Opponent,
		battingSide,
		input.OwnScore,
		input.OpponentScore,
		input.Raw,
		lineups,
		events,
	)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game", "id": id}, fmt.Sprintf("game saved: %d\n", id))
}

// Run 创建一场可继续补充数据的比赛。
func (cmd *GameCreateCmd) Run(ctx *Context) error {
	var input gameCreateInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"game", "create"}); err != nil {
		return err
	}
	battingSide, err := parseBattingSide(input.BattingSide)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.CreateGame(input.Date, input.StartTime, input.Opponent, battingSide, input.Raw)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game", "id": id}, fmt.Sprintf("game created: %d\n", id))
}

// Run 读取并追加一条比赛阵容记录。
func (cmd *GameLineupAddCmd) Run(ctx *Context) error {
	var input gameLineupAddInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"game", "lineup", "add"}); err != nil {
		return err
	}
	team, err := parseTeam(input.Team)
	if err != nil {
		return err
	}
	startingPosition, err := parseOptionalStartingPosition(input.StartingPosition)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.AddGameLineup(input.GameID, team, input.Player, input.BattingOrder, startingPosition)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_lineup", "id": id, "game_id": input.GameID}, fmt.Sprintf("lineup added: %d\n", id))
}

// Run 读取并批量追加比赛事件。
func (cmd *GameEventWriteCmd) Run(ctx *Context) error {
	var input gameEventWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"game", "event", "write"}); err != nil {
		return err
	}
	events, err := eventsFromJSON(input.Events)
	if err != nil {
		return err
	}
	count, err := ctx.GameService.WriteGameEvents(input.GameID, events)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_events", "game_id": input.GameID, "count": count}, fmt.Sprintf("game events saved: %d\n", count))
}

// Run validates a complete batch of game events without persisting it.
func (cmd *GameEventValidateCmd) Run(ctx *Context) error {
	var input gameEventWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"game", "event", "validate"}); err != nil {
		return err
	}
	issues := validateEventRecords(input.GameID, input.Events)
	if len(issues) == 0 {
		events, err := eventsFromJSON(input.Events)
		if err != nil {
			issues = append(issues, eventValidationIssue{
				EventIndex: -1,
				Field:      "events",
				Code:       errorCode(err),
				Expected:   err.Error(),
			})
		} else if err := ctx.GameService.ValidateGameEvents(input.GameID, events); err != nil {
			issues = append(issues, eventValidationIssue{
				EventIndex: -1,
				Field:      "events",
				Code:       errorCode(err),
				Expected:   err.Error(),
			})
		}
	}
	return writeCommandResult(
		ctx,
		map[string]any{
			"valid":   len(issues) == 0,
			"game_id": input.GameID,
			"issues":  issues,
		},
		fmt.Sprintf("game events valid: %t\n", len(issues) == 0),
	)
}

// Run 设置比赛最终比分。
func (cmd *GameScoreSetCmd) Run(ctx *Context) error {
	var input gameScoreSetInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"game", "score", "set"}); err != nil {
		return err
	}
	if err := ctx.GameService.SetGameScore(input.GameID, input.OwnScore, input.OpponentScore); err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_score", "game_id": input.GameID, "own_score": input.OwnScore, "opponent_score": input.OpponentScore}, fmt.Sprintf("score saved: %d\n", input.GameID))
}

// Run 触发指定比赛的单场分析生成。
func (cmd *GameAnalysisGenerateCmd) Run(ctx *Context) error {
	var input gameAnalysisGenerateInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"game", "analysis", "generate"}); err != nil {
		return err
	}
	id, err := ctx.GameService.GenerateGameAnalysis(input.GameID)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_analysis", "id": id, "game_id": input.GameID}, fmt.Sprintf("game analysis generated: %d\n", id))
}

// Run 读取比赛分析，可选筛选球员。
func (cmd *GameAnalysisReadCmd) Run(ctx *Context) error {
	analysis, err := ctx.GameService.ReadGameAnalysis(cmd.GameID, cmd.Player)
	if err != nil {
		return err
	}
	return printGameAnalysis(ctx, analysis)
}

// Run 列出已生成分析的比赛。
func (cmd *GameAnalysisListCmd) Run(ctx *Context) error {
	items, err := ctx.GameService.ListGameAnalyses()
	if err != nil {
		return err
	}
	return printGameAnalysisList(ctx, items)
}

// Run 读取比赛及其明细。
func (cmd *GameReadCmd) Run(ctx *Context) error {
	details, err := ctx.GameService.GetGame(cmd.ID)
	if err != nil {
		return err
	}
	return printGameDetails(ctx, details)
}

// Run 按可选日期列出比赛。
func (cmd *GameListCmd) Run(ctx *Context) error {
	games, err := ctx.GameService.ListGames(cmd.Date)
	if err != nil {
		return err
	}
	return printGameList(ctx, games)
}

// Run 校验生成阵容但不写入数据库。
func (cmd *LineupValidateCmd) Run(ctx *Context) error {
	draft, err := readLineupDraft(ctx, cmd.Input, []string{"lineup", "validate"})
	if err != nil {
		return err
	}
	result, err := ctx.LineupService.Validate(draft)
	if err != nil {
		return err
	}
	return printLineupValidation(ctx, result)
}

// Run 校验并保存生成阵容。
func (cmd *LineupWriteCmd) Run(ctx *Context) error {
	draft, err := readLineupDraft(ctx, cmd.Input, []string{"lineup", "write"})
	if err != nil {
		return err
	}
	id, result, err := ctx.LineupService.Write(draft)
	if err != nil {
		return err
	}
	if !result.Valid {
		return printLineupValidation(ctx, result)
	}
	return writeCommandResult(ctx, map[string]any{
		"resource": "lineup",
		"id":       id,
		"game_id":  draft.GameID,
		"status":   lineup.FormatStatus(lineup.StatusValidated),
	}, fmt.Sprintf("lineup saved: %d\n", id))
}

// Run 读取一个生成阵容。
func (cmd *LineupReadCmd) Run(ctx *Context) error {
	value, err := ctx.LineupService.Get(cmd.ID)
	if err != nil {
		return err
	}
	return printGeneratedLineup(ctx, value)
}

// Run 按可选比赛和状态列出生成阵容。
func (cmd *LineupListCmd) Run(ctx *Context) error {
	var status *lineup.Status
	if strings.TrimSpace(cmd.Status) != "" {
		value, err := lineup.ParseStatus(cmd.Status)
		if err != nil {
			return err
		}
		status = &value
	}
	values, err := ctx.LineupService.List(cmd.GameID, status)
	if err != nil {
		return err
	}
	return printGeneratedLineupList(ctx, values)
}

// Run 接受候选阵容并同步到比赛正式名单。
func (cmd *LineupAcceptCmd) Run(ctx *Context) error {
	result, err := ctx.LineupService.Accept(cmd.ID)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{
		"resource":          "lineup",
		"id":                result.LineupID,
		"game_id":           result.GameID,
		"status":            lineup.FormatStatus(lineup.StatusAccepted),
		"game_lineup_count": result.GameLineupCount,
	}, fmt.Sprintf("lineup accepted: %d\n", result.LineupID))
}

// Run 拒绝候选阵容。
func (cmd *LineupRejectCmd) Run(ctx *Context) error {
	if err := ctx.LineupService.Reject(cmd.ID); err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{
		"resource": "lineup",
		"id":       cmd.ID,
		"status":   lineup.FormatStatus(lineup.StatusRejected),
	}, fmt.Sprintf("lineup rejected: %d\n", cmd.ID))
}

// Run 读取并写入训练推荐。
func (cmd *DrillWriteCmd) Run(ctx *Context) error {
	var input drillWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input, []string{"drill", "recommend", "write"}); err != nil {
		return err
	}
	drillType, err := parseDrillType(input.Type)
	if err != nil {
		return err
	}
	id, err := ctx.DrillService.WriteRecommendation(input.Name, input.URL, input.Reason, drillType, input.Summary)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "drill_recommendation", "id": id}, fmt.Sprintf("drill recommendation saved: %d\n", id))
}

// Run 按筛选条件列出训练推荐。
func (cmd *DrillListCmd) Run(ctx *Context) error {
	drillType, err := parseOptionalDrillType(cmd.Type)
	if err != nil {
		return err
	}
	status, err := parseOptionalReviewStatus(cmd.Status)
	if err != nil {
		return err
	}
	recommendations, err := ctx.DrillService.ListRecommendations(drill.ListFilter{
		Name:   cmd.Name,
		Type:   drillType,
		Status: status,
	})
	if err != nil {
		return err
	}
	return printDrillRecommendationList(ctx, recommendations)
}

// Run 提交训练推荐的批准审核。
func (cmd *DrillReviewApproveCmd) Run(ctx *Context) error {
	if err := ctx.DrillService.ApproveRecommendation(cmd.RecommendationID, cmd.Coach, cmd.Summary, cmd.Note); err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "drill_recommendation", "id": cmd.RecommendationID, "status": "approved"}, fmt.Sprintf("drill recommendation approved: %d\n", cmd.RecommendationID))
}

// Run 提交训练推荐的拒绝审核。
func (cmd *DrillReviewRejectCmd) Run(ctx *Context) error {
	if err := ctx.DrillService.RejectRecommendation(cmd.RecommendationID, cmd.Coach, cmd.Summary, cmd.Reason); err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "drill_recommendation", "id": cmd.RecommendationID, "status": "rejected"}, fmt.Sprintf("drill recommendation rejected: %d\n", cmd.RecommendationID))
}

// Run 列出已批准的训练内容。
func (cmd *DrillTrainingListCmd) Run(ctx *Context) error {
	drillType, err := parseOptionalDrillType(cmd.Type)
	if err != nil {
		return err
	}
	trainings, err := ctx.DrillService.ListTrainings(drill.ListFilter{
		Name: cmd.Name,
		Type: drillType,
	})
	if err != nil {
		return err
	}
	return printDrillTrainingList(ctx, trainings)
}

// Run 读取一条已批准训练。
func (cmd *DrillTrainingReadCmd) Run(ctx *Context) error {
	training, err := ctx.DrillService.GetTraining(cmd.RecommendationID)
	if err != nil {
		return err
	}
	return printDrillTraining(ctx, training)
}

// Run 读取球员跨周期表现分析。
func (cmd *PersonAnalysisReadCmd) Run(ctx *Context) error {
	result, err := ctx.PersonService.ReadPersonAnalysis(cmd.Name, cmd.From, cmd.To)
	if err != nil {
		return err
	}
	return printPersonAnalysis(ctx, result)
}

// printPlayer 按当前输出格式序列化球员资料。
func printPlayer(ctx *Context, p player.Player) error {
	return writeStructured(ctx, playerReadTOML{Player: playerTOMLFrom(p)})
}

// printPlayerList 输出已登记球员列表。
func printPlayerList(ctx *Context, players []player.Player) error {
	output := playerListTOML{Players: make([]playerTOML, 0, len(players))}
	for _, value := range players {
		output.Players = append(output.Players, playerTOMLFrom(value))
	}
	return writeStructured(ctx, output)
}

// printReport 按当前输出格式序列化训练报告。
func printReport(ctx *Context, report report.Report) error {
	return writeStructured(ctx, reportReadTOML{Report: reportTOMLFrom(report)})
}

// writeStructured 根据格式开关输出结构化 JSON 或 TOML。
func writeStructured(ctx *Context, value any) error {
	switch ctx.Format {
	case "toml":
		writeTOML(ctx.Out, value)
		return nil
	case "text":
		writeTOML(ctx.Out, value)
		return nil
	default:
		data, err := dataFromTOMLTags(value)
		if err != nil {
			return err
		}
		return writeJSONData(ctx.Out, data)
	}
}

// writeCommandResult 在文本格式输出摘要，其他格式输出结构化数据。
func writeCommandResult(ctx *Context, data map[string]any, text string) error {
	if ctx.Format == "text" {
		fmt.Fprint(ctx.Out, text)
		return nil
	}
	if ctx.Format == "toml" {
		writeTOML(ctx.Out, data)
		return nil
	}
	return writeJSONData(ctx.Out, data)
}

func runBatch(ctx *Context, inputPath string, mode string, command []string) error {
	var input batchInput
	if err := readJSONInput(ctx, inputPath, &input, command); err != nil {
		return err
	}
	if len(input.Operations) == 0 {
		return errors.New("missing required field \"operations\": expected non-empty array")
	}

	results := make([]batchOperationResult, 0, len(input.Operations))
	for index, operation := range input.Operations {
		risk, err := classifyBatchOperation(operation.Args)
		if err != nil {
			return batchOperationError{
				Index:   index,
				Args:    operation.Args,
				Code:    "invalid_command",
				Message: err.Error(),
			}
		}
		if mode == "read" && risk != "read" {
			return batchOperationError{
				Index:   index,
				Args:    operation.Args,
				Code:    "invalid_command",
				Message: fmt.Sprintf("batch read only accepts read-only commands; %q is %s", strings.Join(operation.Args, " "), risk),
			}
		}
		envelope, err := runBatchOperation(ctx, operation)
		if err != nil {
			return batchOperationError{
				Index:   index,
				Args:    operation.Args,
				Code:    "internal_error",
				Message: err.Error(),
			}
		}
		if !envelope.Ok {
			code := "internal_error"
			message := "operation failed"
			var details any
			if envelope.Error != nil {
				code = envelope.Error.Code
				message = envelope.Error.Message
				details = envelope.Error.Details
			}
			return batchOperationError{
				Index:   index,
				Args:    operation.Args,
				Code:    code,
				Message: message,
				Details: details,
			}
		}
		results = append(results, batchOperationResult{
			Index: index,
			Args:  append([]string(nil), operation.Args...),
			Ok:    true,
			Data:  envelope.Data,
		})
	}

	return writeCommandResult(
		ctx,
		map[string]any{
			"resource":   "batch",
			"mode":       mode,
			"count":      len(results),
			"operations": results,
		},
		fmt.Sprintf("batch %s completed: %d\n", mode, len(results)),
	)
}

func runBatchOperation(ctx *Context, operation batchOperationInput) (jsonEnvelope, error) {
	args := append([]string{"--db", ctx.DB, "--format", "json"}, operation.Args...)
	var input io.Reader = strings.NewReader("")
	if len(operation.Input) > 0 {
		args = append(args, "--input", "-")
		input = bytes.NewReader(operation.Input)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := RunWithIO(args, input, &stdout, &stderr)
	var envelope jsonEnvelope
	if decodeErr := json.Unmarshal(stdout.Bytes(), &envelope); decodeErr != nil {
		if err != nil {
			return jsonEnvelope{}, fmt.Errorf("%w; stderr: %s", err, strings.TrimSpace(stderr.String()))
		}
		return jsonEnvelope{}, fmt.Errorf("decode operation output: %w", decodeErr)
	}
	return envelope, nil
}

type batchCommandRisk struct {
	Path []string
	Risk string
}

var batchCommandRisks = []batchCommandRisk{
	{[]string{"game", "analysis", "generate"}, "compute_write"},
	{[]string{"drill", "recommend", "write"}, "write"},
	{[]string{"drill", "review", "approve"}, "write"},
	{[]string{"drill", "review", "reject"}, "write"},
	{[]string{"game", "event", "validate"}, "read"},
	{[]string{"game", "event", "write"}, "write"},
	{[]string{"game", "lineup", "add"}, "write"},
	{[]string{"game", "score", "set"}, "write"},
	{[]string{"game", "analysis", "read"}, "read"},
	{[]string{"game", "analysis", "list"}, "read"},
	{[]string{"person", "analysis", "read"}, "read"},
	{[]string{"drill", "recommend", "list"}, "read"},
	{[]string{"drill", "training", "list"}, "read"},
	{[]string{"drill", "training", "read"}, "read"},
	{[]string{"player", "add"}, "write"},
	{[]string{"player", "read"}, "read"},
	{[]string{"player", "list"}, "read"},
	{[]string{"report", "write"}, "write"},
	{[]string{"report", "read"}, "read"},
	{[]string{"game", "write"}, "write"},
	{[]string{"game", "create"}, "write"},
	{[]string{"game", "read"}, "read"},
	{[]string{"game", "list"}, "read"},
	{[]string{"lineup", "validate"}, "read"},
	{[]string{"lineup", "write"}, "write"},
	{[]string{"lineup", "read"}, "read"},
	{[]string{"lineup", "list"}, "read"},
	{[]string{"lineup", "accept"}, "write"},
	{[]string{"lineup", "reject"}, "write"},
}

func classifyBatchOperation(args []string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("operation args must contain a registered command")
	}
	for _, token := range args {
		if token == "--db" || token == "--format" || token == "--input" {
			return "", fmt.Errorf("operation args must not include %s", token)
		}
	}
	if args[0] == "batch" {
		return "", errors.New("batch operations cannot be nested")
	}
	for _, candidate := range batchCommandRisks {
		if len(args) < len(candidate.Path) {
			continue
		}
		matched := true
		for index, token := range candidate.Path {
			if args[index] != token {
				matched = false
				break
			}
		}
		if matched {
			return candidate.Risk, nil
		}
	}
	return "", fmt.Errorf("operation command is not registered: %s", strings.Join(args, " "))
}

// writeTOML 将值编码为 TOML，编码失败时写出可读错误。
func writeTOML(out io.Writer, value any) {
	data, err := toml.Marshal(value)
	if err != nil {
		panic(fmt.Sprintf("marshal CLI output as TOML: %v", err))
	}
	fmt.Fprint(out, string(data))
}

// writeJSONData 将命令数据包装为成功响应并编码为 JSON。
func writeJSONData(out io.Writer, data any) error {
	return writeJSON(out, jsonEnvelope{Ok: true, Data: data})
}

// writeError 按选定格式输出统一的命令错误响应。
func writeError(out io.Writer, format string, err error) {
	if err == nil || format == "toml" || format == "text" {
		return
	}
	var withDetails interface{ ErrorDetails() any }
	details := any(nil)
	if errors.As(err, &withDetails) {
		details = withDetails.ErrorDetails()
	}
	_ = writeJSON(out, jsonEnvelope{
		Ok: false,
		Error: &jsonError{
			Code:    errorCode(err),
			Message: err.Error(),
			Details: details,
		},
	})
}

// writeJSON 使用缩进格式编码 JSON 响应。
func writeJSON(out io.Writer, value any) error {
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

// dataFromTOMLTags 将带 TOML 标签的值转换为适合 JSON 的字段名。
func dataFromTOMLTags(value any) (any, error) {
	data, err := toml.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal CLI output as TOML: %w", err)
	}
	var decoded map[string]any
	if err := toml.Unmarshal(data, &decoded); err != nil {
		return nil, fmt.Errorf("convert CLI output to JSON data: %w", err)
	}
	return decoded, nil
}

// readJSONInput 读取、校验必填字段并解码命令 JSON 输入。
func readJSONInput(ctx *Context, path string, value any, command []string) error {
	raw, err := readInput(ctx, path)
	if err != nil {
		return err
	}
	required, err := requiredFieldsForCommand(command)
	if err != nil {
		return err
	}
	if err := requireJSONFields(raw, required); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("invalid --input: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("invalid --input: expected a single JSON value")
	}
	return nil
}

// requireJSONFields 在解码前确认 JSON 对象包含全部必填字段。
func requireJSONFields(raw []byte, fields []string) error {
	if len(fields) == 0 {
		return nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil
	}
	for _, field := range fields {
		if _, ok := object[field]; !ok {
			return fmt.Errorf("missing required field %q", field)
		}
	}
	return nil
}

// readInput 从标准输入或指定路径读取原始命令输入。
func readInput(ctx *Context, path string) ([]byte, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("--input is required")
	}
	if path == "-" {
		raw, err := io.ReadAll(ctx.In)
		if err != nil {
			return nil, fmt.Errorf("read --input -: %w", err)
		}
		return raw, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read --input %q: %w", path, err)
	}
	return raw, nil
}

// errorCode 将常见业务错误映射为稳定的机器可读错误码。
func errorCode(err error) string {
	var coded interface{ ErrorCode() string }
	if errors.As(err, &coded) {
		return coded.ErrorCode()
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "missing required"):
		return "missing_required"
	case strings.Contains(message, "unknown field"):
		return "unknown_field"
	case strings.Contains(message, "invalid character"), strings.Contains(message, "cannot unmarshal"), strings.Contains(message, "unexpected eof"):
		return "parse_error"
	case strings.Contains(message, "not found"):
		return "not_found"
	case strings.Contains(message, "already exists"):
		return "conflict"
	case strings.Contains(message, "invalid"), strings.Contains(message, "expected"), strings.Contains(message, "cannot be empty"), strings.Contains(message, "no analyzable"):
		return "invalid_value"
	default:
		return "internal_error"
	}
}

type jsonEnvelope struct {
	Ok    bool       `json:"ok"`
	Data  any        `json:"data,omitempty"`
	Error *jsonError `json:"error,omitempty"`
}

type jsonError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

type playerReadTOML struct {
	Player playerTOML `toml:"player"`
}

type playerListTOML struct {
	Players []playerTOML `toml:"players"`
}

type playerTOML struct {
	Name      string `toml:"name"`
	Number    int    `toml:"number"`
	Bat       string `toml:"bat"`
	Throw     string `toml:"throw"`
	Positions string `toml:"positions"`
}

// playerTOMLFrom 将球员领域对象转换为 TOML 输出对象。
func playerTOMLFrom(p player.Player) playerTOML {
	return playerTOML{
		Name:      p.Name,
		Number:    p.Number,
		Bat:       player.FormatHands(p.Bat),
		Throw:     player.FormatHands(p.Throw),
		Positions: player.FormatPositions(p.Positions),
	}
}

type reportReadTOML struct {
	Report reportTOML `toml:"report"`
}

type reportTOML struct {
	Name       string `toml:"name"`
	Date       string `toml:"date"`
	Content    string `toml:"content"`
	Reflection string `toml:"reflection"`
}

// reportTOMLFrom 将训练报告转换为 TOML 输出对象。
func reportTOMLFrom(r report.Report) reportTOML {
	return reportTOML{
		Name:       r.Name,
		Date:       r.Date,
		Content:    r.Content,
		Reflection: r.Reflection,
	}
}

type playerAddInput struct {
	Name      string `json:"name"`
	Number    int    `json:"number"`
	Bat       string `json:"bat"`
	Throw     string `json:"throw"`
	Positions string `json:"positions"`
}

type reportWriteInput struct {
	Name       string `json:"name"`
	Date       string `json:"date"`
	Content    string `json:"content"`
	Reflection string `json:"reflection"`
}

type batchInput struct {
	Operations []batchOperationInput `json:"operations"`
}

type batchOperationInput struct {
	Args  []string        `json:"args"`
	Input json.RawMessage `json:"input,omitempty"`
}

type batchOperationResult struct {
	Index int      `json:"index"`
	Args  []string `json:"args"`
	Ok    bool     `json:"ok"`
	Data  any      `json:"data,omitempty"`
}

type batchOperationError struct {
	Index   int
	Args    []string
	Code    string
	Message string
	Details any
}

func (err batchOperationError) Error() string {
	return fmt.Sprintf("batch operation %d failed: %s", err.Index, err.Message)
}

func (err batchOperationError) ErrorCode() string {
	return err.Code
}

func (err batchOperationError) ErrorDetails() any {
	return map[string]any{
		"index":   err.Index,
		"args":    err.Args,
		"code":    err.Code,
		"message": err.Message,
		"details": err.Details,
	}
}

type gameWriteInput struct {
	Date          string       `json:"date"`
	StartTime     string       `json:"start_time"`
	Opponent      string       `json:"opponent"`
	BattingSide   string       `json:"batting_side"`
	OwnScore      int          `json:"own_score"`
	OpponentScore int          `json:"opponent_score"`
	Raw           string       `json:"raw"`
	Lineups       []lineupJSON `json:"lineups"`
	Events        []eventJSON  `json:"events"`
}

type gameCreateInput struct {
	Date        string `json:"date"`
	StartTime   string `json:"start_time"`
	Opponent    string `json:"opponent"`
	BattingSide string `json:"batting_side"`
	Raw         string `json:"raw"`
}

type gameLineupAddInput struct {
	GameID           int64   `json:"game_id"`
	Team             string  `json:"team"`
	Player           string  `json:"player"`
	BattingOrder     *int    `json:"batting_order"`
	StartingPosition *string `json:"starting_position"`
}

type gameEventWriteInput struct {
	GameID int64       `json:"game_id"`
	Events []eventJSON `json:"events"`
}

type gameScoreSetInput struct {
	GameID        int64 `json:"game_id"`
	OwnScore      int   `json:"own_score"`
	OpponentScore int   `json:"opponent_score"`
}

type gameAnalysisGenerateInput struct {
	GameID int64 `json:"game_id"`
}

type generatedLineupInput struct {
	SchemaVersion string                 `json:"schema_version"`
	GameID        int64                  `json:"game_id"`
	Strategy      string                 `json:"strategy"`
	Starters      []generatedStarterJSON `json:"starters"`
	Bench         []generatedBenchJSON   `json:"bench"`
	PitchingPlan  []pitchingPlanJSON     `json:"pitching_plan"`
	Reasoning     []string               `json:"reasoning"`
}

type generatedStarterJSON struct {
	Player       string `json:"player"`
	Position     string `json:"position"`
	BattingOrder int    `json:"batting_order"`
}

type generatedBenchJSON struct {
	Player        string `json:"player"`
	SuggestedRole string `json:"suggested_role"`
}

type pitchingPlanJSON struct {
	Player         string `json:"player"`
	Role           string `json:"role"`
	PlannedInnings *int   `json:"planned_innings"`
}

type drillWriteInput struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Reason  string `json:"reason"`
	Type    string `json:"type"`
	Summary string `json:"summary"`
}

type lineupJSON struct {
	Team             string  `json:"team"`
	Player           string  `json:"player"`
	BattingOrder     *int    `json:"batting_order"`
	StartingPosition *string `json:"starting_position"`
}

type eventJSON struct {
	Inning        int     `json:"inning"`
	Half          string  `json:"half"`
	PlayNo        *int    `json:"play_no"`
	Sequence      int     `json:"sequence"`
	EventKind     string  `json:"event_kind"`
	Player        string  `json:"player"`
	Team          string  `json:"team"`
	Result        string  `json:"result"`
	RelatedPlayer string  `json:"related_player"`
	PitchSequence string  `json:"pitch_sequence"`
	BaseFrom      *int    `json:"base_from"`
	BaseTo        *int    `json:"base_to"`
	Reason        *string `json:"reason"`
	OutsOnPlay    int     `json:"outs_on_play"`
	RunsScored    int     `json:"runs_scored"`
	RBIPlayer     string  `json:"rbi_player"`
	Earned        *bool   `json:"earned"`
	Value         int     `json:"value"`
	Description   string  `json:"description"`
}

type eventValidationIssue struct {
	EventIndex int    `json:"eventIndex" toml:"event_index"`
	Field      string `json:"field" toml:"field"`
	Code       string `json:"code" toml:"code"`
	Expected   string `json:"expected" toml:"expected"`
}

func validateEventRecords(gameID int64, records []eventJSON) []eventValidationIssue {
	issues := make([]eventValidationIssue, 0)
	if gameID <= 0 {
		issues = append(issues, eventValidationIssue{
			EventIndex: -1, Field: "game_id", Code: "invalid_value", Expected: "positive integer",
		})
	}
	if len(records) == 0 {
		issues = append(issues, eventValidationIssue{
			EventIndex: -1, Field: "events", Code: "missing_required", Expected: "non-empty array",
		})
		return issues
	}
	for index, record := range records {
		kind, kindErr := parseEventKind(record.EventKind)
		if kindErr != nil {
			issues = append(issues, eventValidationIssue{
				EventIndex: index, Field: "event_kind", Code: "invalid_value",
				Expected: enumLabels(eventKindOptions),
			})
			continue
		}
		if _, err := parseEventResult(kind, record.Result); err != nil {
			var expected string
			switch kind {
			case game.EventKindPlateResult:
				expected = enumLabels(plateResultOptions)
			case game.EventKindRunnerMovement:
				expected = enumLabels(runnerResultOptions)
			case game.EventKindFieldingCredit:
				expected = enumLabels(fieldingResultOptions)
			}
			issues = append(issues, eventValidationIssue{
				EventIndex: index, Field: "result", Code: "invalid_value", Expected: expected,
			})
		}
		if strings.TrimSpace(record.Player) == "" {
			issues = append(issues, eventValidationIssue{
				EventIndex: index, Field: "player", Code: "missing_required", Expected: "non-empty string",
			})
		}
		if _, err := parseTeam(record.Team); err != nil {
			issues = append(issues, eventValidationIssue{
				EventIndex: index, Field: "team", Code: "invalid_value", Expected: enumLabels(teamOptions),
			})
		}
		if _, err := parseHalf(record.Half); err != nil {
			issues = append(issues, eventValidationIssue{
				EventIndex: index, Field: "half", Code: "invalid_value", Expected: enumLabels(halfOptions),
			})
		}
		if record.Inning < 1 {
			issues = append(issues, eventValidationIssue{
				EventIndex: index, Field: "inning", Code: "invalid_value", Expected: "integer >= 1",
			})
		}
		if record.Sequence <= 0 {
			issues = append(issues, eventValidationIssue{
				EventIndex: index, Field: "sequence", Code: "invalid_value", Expected: "positive integer",
			})
		}
		switch kind {
		case game.EventKindPlateResult:
			if strings.TrimSpace(record.RelatedPlayer) == "" {
				issues = append(issues, eventValidationIssue{
					EventIndex: index, Field: "related_player", Code: "missing_required", Expected: "reported opposing player",
				})
			}
			if strings.TrimSpace(record.PitchSequence) == "" {
				issues = append(issues, eventValidationIssue{
					EventIndex: index, Field: "pitch_sequence", Code: "missing_required", Expected: "reported pitch sequence",
				})
			}
		case game.EventKindRunnerMovement:
			if record.BaseFrom == nil {
				issues = append(issues, eventValidationIssue{
					EventIndex: index, Field: "base_from", Code: "missing_required", Expected: "integer 0-3",
				})
			}
			if record.Result != "out" && record.BaseTo == nil {
				issues = append(issues, eventValidationIssue{
					EventIndex: index, Field: "base_to", Code: "missing_required", Expected: "integer 1-4",
				})
			}
		}
	}
	return issues
}

// readLineupDraft 严格读取生成阵容并转换位置和投手角色枚举。
func readLineupDraft(ctx *Context, path string, command []string) (lineup.Draft, error) {
	var input generatedLineupInput
	if err := readJSONInput(ctx, path, &input, command); err != nil {
		return lineup.Draft{}, err
	}
	draft := lineup.Draft{
		SchemaVersion: input.SchemaVersion,
		GameID:        input.GameID,
		Strategy:      input.Strategy,
		Reasoning:     input.Reasoning,
		Starters:      make([]lineup.Starter, 0, len(input.Starters)),
		Bench:         make([]lineup.BenchEntry, 0, len(input.Bench)),
		PitchingPlan:  make([]lineup.PitchingPlan, 0, len(input.PitchingPlan)),
	}
	for i, value := range input.Starters {
		position, err := lineup.ParsePosition(value.Position)
		if err != nil {
			return lineup.Draft{}, fmt.Errorf("invalid starters[%d].position: %w", i, err)
		}
		draft.Starters = append(draft.Starters, lineup.Starter{
			Player:       value.Player,
			Position:     position,
			BattingOrder: value.BattingOrder,
		})
	}
	for _, value := range input.Bench {
		draft.Bench = append(draft.Bench, lineup.BenchEntry{Player: value.Player, SuggestedRole: value.SuggestedRole})
	}
	for i, value := range input.PitchingPlan {
		role, err := lineup.ParsePitchingRole(value.Role)
		if err != nil {
			return lineup.Draft{}, fmt.Errorf("invalid pitching_plan[%d].role: %w", i, err)
		}
		draft.PitchingPlan = append(draft.PitchingPlan, lineup.PitchingPlan{
			Player:         value.Player,
			Sequence:       i + 1,
			Role:           role,
			PlannedInnings: value.PlannedInnings,
		})
	}
	return draft, nil
}

// lineupsFromJSON 将输入阵容记录转换为领域对象。
func lineupsFromJSON(records []lineupJSON) ([]game.GameLineup, error) {
	lineups := make([]game.GameLineup, 0, len(records))
	for i, record := range records {
		team, err := parseTeam(record.Team)
		if err != nil {
			return nil, fmt.Errorf("invalid lineups[%d]: %w", i, err)
		}
		startingPosition, err := parseOptionalStartingPosition(record.StartingPosition)
		if err != nil {
			return nil, fmt.Errorf("invalid lineups[%d]: %w", i, err)
		}
		lineups = append(lineups, game.GameLineup{
			Team:             team,
			Player:           record.Player,
			BattingOrder:     record.BattingOrder,
			StartingPosition: startingPosition,
		})
	}
	if lineups == nil {
		lineups = []game.GameLineup{}
	}
	return lineups, nil
}

// eventsFromJSON 将输入事件记录解析为领域对象及枚举。
func eventsFromJSON(records []eventJSON) ([]game.GameEvent, error) {
	events := make([]game.GameEvent, 0, len(records))
	for i, record := range records {
		half, err := parseHalf(record.Half)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		kind, err := parseEventKind(record.EventKind)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		team, err := parseTeam(record.Team)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		result, err := parseEventResult(kind, record.Result)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		var reason *game.RunnerReason
		if record.Reason != nil && strings.TrimSpace(*record.Reason) != "" {
			parsed, err := parseRunnerReason(*record.Reason)
			if err != nil {
				return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
			}
			reason = &parsed
		}
		events = append(events, game.GameEvent{
			Inning:        record.Inning,
			Half:          half,
			PlayNo:        record.PlayNo,
			Sequence:      record.Sequence,
			EventKind:     kind,
			Player:        record.Player,
			Team:          team,
			Result:        result,
			RelatedPlayer: record.RelatedPlayer,
			PitchSequence: record.PitchSequence,
			BaseFrom:      record.BaseFrom,
			BaseTo:        record.BaseTo,
			Reason:        reason,
			OutsOnPlay:    record.OutsOnPlay,
			RunsScored:    record.RunsScored,
			RBIPlayer:     record.RBIPlayer,
			Earned:        record.Earned,
			Value:         record.Value,
			Description:   record.Description,
		})
	}
	if events == nil {
		events = []game.GameEvent{}
	}
	return events, nil
}

// printGameDetails 输出比赛主记录、阵容与事件明细。
func printGameDetails(ctx *Context, details game.GameDetails) error {
	output := gameDetailsTOML{
		Game:    gameTOMLFrom(details.Game),
		Lineups: make([]lineupTOML, 0, len(details.Lineups)),
		Events:  make([]eventTOML, 0, len(details.Events)),
	}
	for _, row := range details.Lineups {
		output.Lineups = append(output.Lineups, lineupTOMLFrom(row))
	}
	for _, row := range details.Events {
		output.Events = append(output.Events, eventTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

// printGameList 输出比赛列表。
func printGameList(ctx *Context, games []game.Game) error {
	if len(games) == 0 && ctx.Format == "toml" {
		return nil
	}
	output := gameListTOML{Games: make([]gameTOML, 0, len(games))}
	for _, row := range games {
		output.Games = append(output.Games, gameTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

// printGameAnalysis 输出完整单场比赛分析。
func printGameAnalysis(ctx *Context, result game.GameAnalysisResult) error {
	output := gameAnalysisTOML{
		Analysis:        gameAnalysisHeaderTOMLFrom(result.Analysis),
		PlayerSummaries: make([]playerSummaryTOML, 0, len(result.Summaries)),
		Batting:         make([]battingTOML, 0, len(result.Batting)),
		Baserunning:     make([]baserunningTOML, 0, len(result.Baserunning)),
		Pitching:        make([]pitchingTOML, 0, len(result.Pitching)),
		Fielding:        make([]fieldingTOML, 0, len(result.Fielding)),
		DataGaps:        make([]dataGapTOML, 0, len(result.DataGaps)),
	}
	for _, row := range result.Summaries {
		output.PlayerSummaries = append(output.PlayerSummaries, playerSummaryTOMLFrom(row))
	}
	for _, row := range result.Batting {
		output.Batting = append(output.Batting, battingTOMLFrom(row))
	}
	for _, row := range result.Baserunning {
		output.Baserunning = append(output.Baserunning, baserunningTOMLFrom(row))
	}
	for _, row := range result.Pitching {
		output.Pitching = append(output.Pitching, pitchingTOMLFrom(row))
	}
	for _, row := range result.Fielding {
		output.Fielding = append(output.Fielding, fieldingTOMLFrom(row))
	}
	for _, row := range result.DataGaps {
		output.DataGaps = append(output.DataGaps, dataGapTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

// printGameAnalysisList 输出已生成分析的比赛摘要列表。
func printGameAnalysisList(ctx *Context, items []game.GameAnalysisListItem) error {
	if len(items) == 0 && ctx.Format == "toml" {
		return nil
	}
	output := gameAnalysisListTOML{Analyses: make([]gameAnalysisListItemTOML, 0, len(items))}
	for _, row := range items {
		output.Analyses = append(output.Analyses, gameAnalysisListItemTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

// printDrillRecommendationList 输出训练推荐列表。
func printDrillRecommendationList(ctx *Context, recommendations []drill.Recommendation) error {
	if len(recommendations) == 0 && ctx.Format == "toml" {
		return nil
	}
	output := drillRecommendationListTOML{Drills: make([]drillRecommendationTOML, 0, len(recommendations))}
	for _, row := range recommendations {
		output.Drills = append(output.Drills, drillRecommendationTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

// printDrillTrainingList 输出已批准训练列表。
func printDrillTrainingList(ctx *Context, trainings []drill.Recommendation) error {
	if len(trainings) == 0 && ctx.Format == "toml" {
		return nil
	}
	output := drillTrainingListTOML{Trainings: make([]drillRecommendationTOML, 0, len(trainings))}
	for _, row := range trainings {
		output.Trainings = append(output.Trainings, drillRecommendationTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

// printDrillTraining 输出一条已批准训练。
func printDrillTraining(ctx *Context, training drill.Recommendation) error {
	return writeStructured(ctx, drillTrainingReadTOML{Training: drillRecommendationTOMLFrom(training)})
}

// printPersonAnalysis 输出跨周期个人表现分析。
func printPersonAnalysis(ctx *Context, result person.AnalysisResult) error {
	output := personAnalysisTOML{
		Analysis:    personAnalysisHeaderTOMLFrom(result.Analysis),
		Summary:     personSummaryTOMLFrom(result.Summary),
		Batting:     personBattingTOMLFrom(result.Batting),
		Baserunning: personBaserunningTOMLFrom(result.Baserunning),
		Pitching:    personPitchingTOMLFrom(result.Pitching),
		Fielding:    personFieldingTOMLFrom(result.Fielding),
		DataGaps:    make([]dataGapTOML, 0, len(result.DataGaps)),
	}
	for _, row := range result.DataGaps {
		output.DataGaps = append(output.DataGaps, dataGapTOML{Scope: row.Scope, Message: row.Message})
	}
	return writeStructured(ctx, output)
}

// printLineupValidation 输出阵容校验结果及全部问题。
func printLineupValidation(ctx *Context, result lineup.ValidationResult) error {
	return writeStructured(ctx, lineupValidationTOML{
		Valid:        result.Valid,
		GameID:       result.GameID,
		StarterCount: result.StarterCount,
		BenchCount:   result.BenchCount,
		Errors:       result.Errors,
		Warnings:     result.Warnings,
	})
}

// printGeneratedLineup 输出完整生成阵容。
func printGeneratedLineup(ctx *Context, value lineup.Lineup) error {
	return writeStructured(ctx, generatedLineupTOMLFrom(value))
}

// printGeneratedLineupList 输出阵容方案摘要列表。
func printGeneratedLineupList(ctx *Context, values []lineup.Lineup) error {
	output := generatedLineupListTOML{Lineups: make([]generatedLineupSummaryTOML, 0, len(values))}
	for _, value := range values {
		output.Lineups = append(output.Lineups, generatedLineupSummaryTOML{
			ID:         value.ID,
			GameID:     value.GameID,
			Status:     lineup.FormatStatus(value.Status),
			Strategy:   value.Strategy,
			CreatedAt:  value.CreatedAt,
			AcceptedAt: value.AcceptedAt,
		})
	}
	return writeStructured(ctx, output)
}

type lineupValidationTOML struct {
	Valid        bool           `toml:"valid"`
	GameID       int64          `toml:"game_id"`
	StarterCount int            `toml:"starter_count"`
	BenchCount   int            `toml:"bench_count"`
	Errors       []lineup.Issue `toml:"errors"`
	Warnings     []lineup.Issue `toml:"warnings"`
}

type generatedLineupTOML struct {
	ID            int64                  `toml:"id"`
	GameID        int64                  `toml:"game_id"`
	SchemaVersion string                 `toml:"schema_version"`
	Status        string                 `toml:"status"`
	Strategy      string                 `toml:"strategy"`
	Reasoning     []string               `toml:"reasoning"`
	Warnings      []lineup.Issue         `toml:"warnings"`
	CreatedAt     string                 `toml:"created_at"`
	AcceptedAt    string                 `toml:"accepted_at"`
	Starters      []generatedStarterTOML `toml:"starters"`
	Bench         []generatedBenchTOML   `toml:"bench"`
	PitchingPlan  []pitchingPlanTOML     `toml:"pitching_plan"`
}

type generatedStarterTOML struct {
	Player       string `toml:"player"`
	Position     string `toml:"position"`
	BattingOrder int    `toml:"batting_order"`
}

type generatedBenchTOML struct {
	Player        string `toml:"player"`
	SuggestedRole string `toml:"suggested_role"`
}

type pitchingPlanTOML struct {
	Player         string `toml:"player"`
	Sequence       int    `toml:"sequence"`
	Role           string `toml:"role"`
	PlannedInnings *int   `toml:"planned_innings,omitempty"`
}

type generatedLineupListTOML struct {
	Lineups []generatedLineupSummaryTOML `toml:"lineups"`
}

type generatedLineupSummaryTOML struct {
	ID         int64  `toml:"id"`
	GameID     int64  `toml:"game_id"`
	Status     string `toml:"status"`
	Strategy   string `toml:"strategy"`
	CreatedAt  string `toml:"created_at"`
	AcceptedAt string `toml:"accepted_at"`
}

func generatedLineupTOMLFrom(value lineup.Lineup) generatedLineupTOML {
	output := generatedLineupTOML{
		ID:            value.ID,
		GameID:        value.GameID,
		SchemaVersion: value.SchemaVersion,
		Status:        lineup.FormatStatus(value.Status),
		Strategy:      value.Strategy,
		Reasoning:     value.Reasoning,
		Warnings:      value.Warnings,
		CreatedAt:     value.CreatedAt,
		AcceptedAt:    value.AcceptedAt,
		Starters:      []generatedStarterTOML{},
		Bench:         []generatedBenchTOML{},
		PitchingPlan:  []pitchingPlanTOML{},
	}
	for _, entry := range value.Entries {
		if entry.Role == lineup.RoleStarter && entry.Position != nil && entry.BattingOrder != nil {
			output.Starters = append(output.Starters, generatedStarterTOML{
				Player: entry.Player, Position: lineup.FormatPosition(*entry.Position), BattingOrder: *entry.BattingOrder,
			})
		} else if entry.Role == lineup.RoleBench {
			output.Bench = append(output.Bench, generatedBenchTOML{Player: entry.Player, SuggestedRole: entry.SuggestedRole})
		}
	}
	for _, plan := range value.PitchingPlan {
		output.PitchingPlan = append(output.PitchingPlan, pitchingPlanTOML{
			Player: plan.Player, Sequence: plan.Sequence, Role: lineup.FormatPitchingRole(plan.Role), PlannedInnings: plan.PlannedInnings,
		})
	}
	return output
}

type gameDetailsTOML struct {
	Game    gameTOML     `toml:"game"`
	Lineups []lineupTOML `toml:"lineups"`
	Events  []eventTOML  `toml:"events"`
}

type gameListTOML struct {
	Games []gameTOML `toml:"games"`
}

type gameTOML struct {
	ID            int64  `toml:"id"`
	Date          string `toml:"date"`
	StartTime     string `toml:"start_time"`
	Opponent      string `toml:"opponent"`
	BattingSide   string `toml:"batting_side"`
	OwnScore      int    `toml:"own_score"`
	OpponentScore int    `toml:"opponent_score"`
	Score         string `toml:"score"`
	IsFinal       bool   `toml:"is_final"`
	Raw           string `toml:"raw"`
	CreatedAt     string `toml:"created_at"`
}

// gameTOMLFrom 将比赛转换为 TOML 输出对象。
func gameTOMLFrom(g game.Game) gameTOML {
	return gameTOML{
		ID:            g.ID,
		Date:          g.Date,
		StartTime:     g.StartTime,
		Opponent:      g.Opponent,
		BattingSide:   formatBattingSide(g.BattingSide),
		OwnScore:      g.OwnScore,
		OpponentScore: g.OpponentScore,
		Score:         fmt.Sprintf("%d-%d", g.OwnScore, g.OpponentScore),
		IsFinal:       g.IsFinal,
		Raw:           g.Raw,
		CreatedAt:     g.CreatedAt,
	}
}

type lineupTOML struct {
	ID               int64   `toml:"id"`
	Team             string  `toml:"team"`
	Player           string  `toml:"player"`
	BattingOrder     *int    `toml:"batting_order,omitempty"`
	StartingPosition *string `toml:"starting_position,omitempty"`
}

// lineupTOMLFrom 将阵容记录转换为 TOML 输出对象。
func lineupTOMLFrom(row game.GameLineup) lineupTOML {
	return lineupTOML{
		ID:               row.ID,
		Team:             formatTeam(row.Team),
		Player:           row.Player,
		BattingOrder:     row.BattingOrder,
		StartingPosition: startingPositionString(row.StartingPosition),
	}
}

type eventTOML struct {
	ID            int64   `toml:"id"`
	Inning        int     `toml:"inning"`
	Half          string  `toml:"half"`
	PlayNo        *int    `toml:"play_no,omitempty"`
	Sequence      int     `toml:"sequence"`
	EventKind     string  `toml:"event_kind"`
	Player        string  `toml:"player"`
	Team          string  `toml:"team"`
	Result        string  `toml:"result"`
	RelatedPlayer string  `toml:"related_player"`
	PitchSequence string  `toml:"pitch_sequence"`
	BaseFrom      *int    `toml:"base_from,omitempty"`
	BaseTo        *int    `toml:"base_to,omitempty"`
	Reason        *string `toml:"reason,omitempty"`
	OutsOnPlay    int     `toml:"outs_on_play"`
	RunsScored    int     `toml:"runs_scored"`
	RBIPlayer     string  `toml:"rbi_player"`
	Earned        *bool   `toml:"earned,omitempty"`
	Value         int     `toml:"value"`
	Description   string  `toml:"description"`
}

// eventTOMLFrom 将比赛事件转换为 TOML 输出对象。
func eventTOMLFrom(row game.GameEvent) eventTOML {
	return eventTOML{
		ID:            row.ID,
		Inning:        row.Inning,
		Half:          formatHalf(row.Half),
		PlayNo:        row.PlayNo,
		Sequence:      row.Sequence,
		EventKind:     formatEventKind(row.EventKind),
		Player:        row.Player,
		Team:          formatTeam(row.Team),
		Result:        formatEventResult(row.EventKind, row.Result),
		RelatedPlayer: row.RelatedPlayer,
		PitchSequence: row.PitchSequence,
		BaseFrom:      row.BaseFrom,
		BaseTo:        row.BaseTo,
		Reason:        runnerReasonString(row.Reason),
		OutsOnPlay:    row.OutsOnPlay,
		RunsScored:    row.RunsScored,
		RBIPlayer:     row.RBIPlayer,
		Earned:        row.Earned,
		Value:         row.Value,
		Description:   row.Description,
	}
}

type gameAnalysisTOML struct {
	Analysis        gameAnalysisHeaderTOML `toml:"analysis"`
	PlayerSummaries []playerSummaryTOML    `toml:"player_summaries"`
	Batting         []battingTOML          `toml:"batting"`
	Baserunning     []baserunningTOML      `toml:"baserunning"`
	Pitching        []pitchingTOML         `toml:"pitching"`
	Fielding        []fieldingTOML         `toml:"fielding"`
	DataGaps        []dataGapTOML          `toml:"data_gaps"`
}

type gameAnalysisHeaderTOML struct {
	GameID          int64  `toml:"game_id"`
	Date            string `toml:"date"`
	Opponent        string `toml:"opponent"`
	OwnRuns         int    `toml:"own_runs"`
	OpponentRuns    int    `toml:"opponent_runs"`
	Score           string `toml:"score"`
	Result          string `toml:"result"`
	IsFinal         bool   `toml:"is_final"`
	PlayersAnalyzed int    `toml:"players_analyzed"`
	GeneratedAt     string `toml:"generated_at"`
}

// gameAnalysisHeaderTOMLFrom 转换比赛分析头部信息。
func gameAnalysisHeaderTOMLFrom(row game.GameAnalysis) gameAnalysisHeaderTOML {
	return gameAnalysisHeaderTOML{
		GameID:          row.GameID,
		Date:            row.Date,
		Opponent:        row.Opponent,
		OwnRuns:         row.OwnRuns,
		OpponentRuns:    row.OpponentRuns,
		Score:           fmt.Sprintf("%d-%d", row.OwnRuns, row.OpponentRuns),
		Result:          formatGameResult(row.Result),
		IsFinal:         row.IsFinal,
		PlayersAnalyzed: row.PlayersAnalyzed,
		GeneratedAt:     row.GeneratedAt,
	}
}

type playerSummaryTOML struct {
	Player               string `toml:"player"`
	BattingOrder         *int   `toml:"batting_order,omitempty"`
	Positions            string `toml:"positions"`
	BattingAvailable     bool   `toml:"batting_available"`
	BaserunningAvailable bool   `toml:"baserunning_available"`
	PitchingAvailable    bool   `toml:"pitching_available"`
	FieldingAvailable    bool   `toml:"fielding_available"`
	Highlight            string `toml:"highlight"`
	Risk                 string `toml:"risk"`
}

// playerSummaryTOMLFrom 转换球员单场表现摘要。
func playerSummaryTOMLFrom(row game.PlayerPerformanceSummary) playerSummaryTOML {
	return playerSummaryTOML{
		Player:               row.Player,
		BattingOrder:         row.BattingOrder,
		Positions:            row.Positions,
		BattingAvailable:     row.BattingAvailable,
		BaserunningAvailable: row.BaserunningAvailable,
		PitchingAvailable:    row.PitchingAvailable,
		FieldingAvailable:    row.FieldingAvailable,
		Highlight:            row.Highlight,
		Risk:                 row.Risk,
	}
}

type battingTOML struct {
	Player                     string  `toml:"player"`
	PA                         int     `toml:"pa"`
	AtBats                     int     `toml:"at_bats"`
	Hits                       int     `toml:"hits"`
	Singles                    int     `toml:"singles"`
	Doubles                    int     `toml:"doubles"`
	Triples                    int     `toml:"triples"`
	Homeruns                   int     `toml:"homeruns"`
	Walks                      int     `toml:"walks"`
	HitByPitch                 int     `toml:"hit_by_pitch"`
	Strikeouts                 int     `toml:"strikeouts"`
	ReachedOnError             int     `toml:"reached_on_error"`
	RunsBattedIn               int     `toml:"runs_batted_in"`
	TotalBases                 int     `toml:"total_bases"`
	BattingAverage             float64 `toml:"batting_average"`
	SimplifiedOnBasePercentage float64 `toml:"simplified_on_base_percentage"`
	SluggingPercentage         float64 `toml:"slugging_percentage"`
	OPS                        float64 `toml:"ops"`
}

// battingTOMLFrom 转换打击统计。
func battingTOMLFrom(row game.PlayerBattingStats) battingTOML {
	return battingTOML{
		Player:                     row.Player,
		PA:                         row.PA,
		AtBats:                     row.AtBats,
		Hits:                       row.Hits,
		Singles:                    row.Singles,
		Doubles:                    row.Doubles,
		Triples:                    row.Triples,
		Homeruns:                   row.Homeruns,
		Walks:                      row.Walks,
		HitByPitch:                 row.HitByPitch,
		Strikeouts:                 row.Strikeouts,
		ReachedOnError:             row.ReachedOnError,
		RunsBattedIn:               row.RunsBattedIn,
		TotalBases:                 row.TotalBases,
		BattingAverage:             row.BattingAverage,
		SimplifiedOnBasePercentage: row.OnBasePercentage,
		SluggingPercentage:         row.SluggingPercentage,
		OPS:                        row.OPS,
	}
}

type baserunningTOML struct {
	Player               string  `toml:"player"`
	Runs                 int     `toml:"runs"`
	StolenBases          int     `toml:"stolen_bases"`
	CaughtStealing       int     `toml:"caught_stealing"`
	StolenBaseAttempts   int     `toml:"stolen_base_attempts"`
	StolenBasePercentage float64 `toml:"stolen_base_percentage"`
	ExtraBasesTaken      int     `toml:"extra_bases_taken"`
	BaserunningOuts      int     `toml:"baserunning_outs"`
}

// baserunningTOMLFrom 转换跑垒统计。
func baserunningTOMLFrom(row game.PlayerBaserunningStats) baserunningTOML {
	return baserunningTOML{
		Player:               row.Player,
		Runs:                 row.Runs,
		StolenBases:          row.StolenBases,
		CaughtStealing:       row.CaughtStealing,
		StolenBaseAttempts:   row.StolenBaseAttempts,
		StolenBasePercentage: row.StolenBasePercentage,
		ExtraBasesTaken:      row.ExtraBasesTaken,
		BaserunningOuts:      row.BaserunningOuts,
	}
}

type pitchingTOML struct {
	Player             string   `toml:"player"`
	OutsRecorded       int      `toml:"outs_recorded"`
	InningsPitched     float64  `toml:"innings_pitched"`
	BattersFaced       int      `toml:"batters_faced"`
	HitsAllowed        int      `toml:"hits_allowed"`
	WalksAllowed       int      `toml:"walks_allowed"`
	Strikeouts         int      `toml:"strikeouts"`
	HomerunsAllowed    int      `toml:"homeruns_allowed"`
	RunsAllowed        int      `toml:"runs_allowed"`
	EarnedRuns         int      `toml:"earned_runs"`
	RA9                float64  `toml:"ra9"`
	ERA                *float64 `toml:"era,omitempty"`
	WHIP               float64  `toml:"whip"`
	StrikeoutWalkRatio *float64 `toml:"strikeout_walk_ratio,omitempty"`
	WildPitches        int      `toml:"wild_pitches"`
	Balks              int      `toml:"balks"`
	Pickoffs           int      `toml:"pickoffs"`
	HitBatters         int      `toml:"hit_batters"`
}

// pitchingTOMLFrom 转换投球统计。
func pitchingTOMLFrom(row game.PlayerPitchingStats) pitchingTOML {
	return pitchingTOML{
		Player:             row.Player,
		OutsRecorded:       row.OutsRecorded,
		InningsPitched:     row.InningsPitched,
		BattersFaced:       row.BattersFaced,
		HitsAllowed:        row.HitsAllowed,
		WalksAllowed:       row.WalksAllowed,
		Strikeouts:         row.Strikeouts,
		HomerunsAllowed:    row.HomerunsAllowed,
		RunsAllowed:        row.RunsAllowed,
		EarnedRuns:         row.EarnedRuns,
		RA9:                row.RA9,
		ERA:                row.ERA,
		WHIP:               row.WHIP,
		StrikeoutWalkRatio: row.StrikeoutWalkRatio,
		WildPitches:        row.WildPitches,
		Balks:              row.Balks,
		Pickoffs:           row.Pickoffs,
		HitBatters:         row.HitBatters,
	}
}

type fieldingTOML struct {
	Player             string  `toml:"player"`
	Positions          string  `toml:"positions"`
	Putouts            int     `toml:"putouts"`
	Assists            int     `toml:"assists"`
	Errors             int     `toml:"errors"`
	TotalChances       int     `toml:"total_chances"`
	FieldingPercentage float64 `toml:"fielding_percentage"`
	DoublePlays        int     `toml:"double_plays"`
	PassedBalls        int     `toml:"passed_balls"`
	OutfieldAssists    int     `toml:"outfield_assists"`
}

// fieldingTOMLFrom 转换守备统计。
func fieldingTOMLFrom(row game.PlayerFieldingStats) fieldingTOML {
	return fieldingTOML{
		Player:             row.Player,
		Positions:          row.Positions,
		Putouts:            row.Putouts,
		Assists:            row.Assists,
		Errors:             row.Errors,
		TotalChances:       row.TotalChances,
		FieldingPercentage: row.FieldingPercentage,
		DoublePlays:        row.DoublePlays,
		PassedBalls:        row.PassedBalls,
		OutfieldAssists:    row.OutfieldAssists,
	}
}

type dataGapTOML struct {
	Scope   string `toml:"scope"`
	Message string `toml:"message"`
}

// dataGapTOMLFrom 转换分析数据缺口。
func dataGapTOMLFrom(row game.AnalysisDataGap) dataGapTOML {
	return dataGapTOML{
		Scope:   row.Scope,
		Message: row.Message,
	}
}

type personAnalysisTOML struct {
	Analysis    personAnalysisHeaderTOML `toml:"analysis"`
	Summary     personSummaryTOML        `toml:"summary"`
	Batting     personBattingTOML        `toml:"batting"`
	Baserunning personBaserunningTOML    `toml:"baserunning"`
	Pitching    personPitchingTOML       `toml:"pitching"`
	Fielding    personFieldingTOML       `toml:"fielding"`
	DataGaps    []dataGapTOML            `toml:"data_gaps"`
}

type personAnalysisHeaderTOML struct {
	Name          string `toml:"name"`
	SpanFrom      string `toml:"span_from"`
	SpanTo        string `toml:"span_to"`
	GamesInSpan   int    `toml:"games_in_span"`
	GamesAnalyzed int    `toml:"games_analyzed"`
	OwnWins       int    `toml:"own_wins"`
	OwnLosses     int    `toml:"own_losses"`
	OwnTies       int    `toml:"own_ties"`
	ComputedAt    string `toml:"computed_at"`
}

// personAnalysisHeaderTOMLFrom 转换个人分析头部信息。
func personAnalysisHeaderTOMLFrom(row person.Analysis) personAnalysisHeaderTOML {
	return personAnalysisHeaderTOML{
		Name:          row.Name,
		SpanFrom:      row.SpanFrom,
		SpanTo:        row.SpanTo,
		GamesInSpan:   row.GamesInSpan,
		GamesAnalyzed: row.GamesAnalyzed,
		OwnWins:       row.OwnWins,
		OwnLosses:     row.OwnLosses,
		OwnTies:       row.OwnTies,
		ComputedAt:    row.ComputedAt,
	}
}

type personSummaryTOML struct {
	Positions            string `toml:"positions"`
	GamesBatting         int    `toml:"games_batting"`
	GamesBaserunning     int    `toml:"games_baserunning"`
	GamesPitching        int    `toml:"games_pitching"`
	GamesFielding        int    `toml:"games_fielding"`
	BattingAvailable     bool   `toml:"batting_available"`
	BaserunningAvailable bool   `toml:"baserunning_available"`
	PitchingAvailable    bool   `toml:"pitching_available"`
	FieldingAvailable    bool   `toml:"fielding_available"`
	Highlight            string `toml:"highlight"`
	Risk                 string `toml:"risk"`
}

// personSummaryTOMLFrom 转换个人表现摘要。
func personSummaryTOMLFrom(row person.PerformanceSummary) personSummaryTOML {
	return personSummaryTOML{
		Positions:            row.Positions,
		GamesBatting:         row.GamesBatting,
		GamesBaserunning:     row.GamesBaserunning,
		GamesPitching:        row.GamesPitching,
		GamesFielding:        row.GamesFielding,
		BattingAvailable:     row.BattingAvailable,
		BaserunningAvailable: row.BaserunningAvailable,
		PitchingAvailable:    row.PitchingAvailable,
		FieldingAvailable:    row.FieldingAvailable,
		Highlight:            row.Highlight,
		Risk:                 row.Risk,
	}
}

type personBattingTOML struct {
	Games              int     `toml:"games"`
	PA                 int     `toml:"pa"`
	AtBats             int     `toml:"at_bats"`
	Hits               int     `toml:"hits"`
	Singles            int     `toml:"singles"`
	Doubles            int     `toml:"doubles"`
	Triples            int     `toml:"triples"`
	Homeruns           int     `toml:"homeruns"`
	Walks              int     `toml:"walks"`
	HitByPitch         int     `toml:"hit_by_pitch"`
	Strikeouts         int     `toml:"strikeouts"`
	ReachedOnError     int     `toml:"reached_on_error"`
	RunsBattedIn       int     `toml:"runs_batted_in"`
	TotalBases         int     `toml:"total_bases"`
	BattingAverage     float64 `toml:"batting_average"`
	OnBasePercentage   float64 `toml:"simplified_on_base_percentage"`
	SluggingPercentage float64 `toml:"slugging_percentage"`
	OPS                float64 `toml:"ops"`
}

// personBattingTOMLFrom 转换周期打击统计。
func personBattingTOMLFrom(row person.BattingStats) personBattingTOML {
	return personBattingTOML{
		Games:              row.Games,
		PA:                 row.PA,
		AtBats:             row.AtBats,
		Hits:               row.Hits,
		Singles:            row.Singles,
		Doubles:            row.Doubles,
		Triples:            row.Triples,
		Homeruns:           row.Homeruns,
		Walks:              row.Walks,
		HitByPitch:         row.HitByPitch,
		Strikeouts:         row.Strikeouts,
		ReachedOnError:     row.ReachedOnError,
		RunsBattedIn:       row.RunsBattedIn,
		TotalBases:         row.TotalBases,
		BattingAverage:     row.BattingAverage,
		OnBasePercentage:   row.OnBasePercentage,
		SluggingPercentage: row.SluggingPercentage,
		OPS:                row.OPS,
	}
}

type personBaserunningTOML struct {
	Games                int     `toml:"games"`
	Runs                 int     `toml:"runs"`
	StolenBases          int     `toml:"stolen_bases"`
	CaughtStealing       int     `toml:"caught_stealing"`
	StolenBaseAttempts   int     `toml:"stolen_base_attempts"`
	StolenBasePercentage float64 `toml:"stolen_base_percentage"`
	ExtraBasesTaken      int     `toml:"extra_bases_taken"`
	BaserunningOuts      int     `toml:"baserunning_outs"`
}

// personBaserunningTOMLFrom 转换周期跑垒统计。
func personBaserunningTOMLFrom(row person.BaserunningStats) personBaserunningTOML {
	return personBaserunningTOML{
		Games:                row.Games,
		Runs:                 row.Runs,
		StolenBases:          row.StolenBases,
		CaughtStealing:       row.CaughtStealing,
		StolenBaseAttempts:   row.StolenBaseAttempts,
		StolenBasePercentage: row.StolenBasePercentage,
		ExtraBasesTaken:      row.ExtraBasesTaken,
		BaserunningOuts:      row.BaserunningOuts,
	}
}

type personPitchingTOML struct {
	Games              int      `toml:"games"`
	OutsRecorded       int      `toml:"outs_recorded"`
	InningsPitched     float64  `toml:"innings_pitched"`
	BattersFaced       int      `toml:"batters_faced"`
	HitsAllowed        int      `toml:"hits_allowed"`
	WalksAllowed       int      `toml:"walks_allowed"`
	Strikeouts         int      `toml:"strikeouts"`
	HomerunsAllowed    int      `toml:"homeruns_allowed"`
	RunsAllowed        int      `toml:"runs_allowed"`
	EarnedRuns         int      `toml:"earned_runs"`
	RA9                float64  `toml:"ra9"`
	ERA                *float64 `toml:"era,omitempty"`
	WHIP               float64  `toml:"whip"`
	StrikeoutWalkRatio *float64 `toml:"strikeout_walk_ratio,omitempty"`
	WildPitches        int      `toml:"wild_pitches"`
	Balks              int      `toml:"balks"`
	Pickoffs           int      `toml:"pickoffs"`
	HitBatters         int      `toml:"hit_batters"`
}

// personPitchingTOMLFrom 转换周期投球统计。
func personPitchingTOMLFrom(row person.PitchingStats) personPitchingTOML {
	return personPitchingTOML{
		Games:              row.Games,
		OutsRecorded:       row.OutsRecorded,
		InningsPitched:     row.InningsPitched,
		BattersFaced:       row.BattersFaced,
		HitsAllowed:        row.HitsAllowed,
		WalksAllowed:       row.WalksAllowed,
		Strikeouts:         row.Strikeouts,
		HomerunsAllowed:    row.HomerunsAllowed,
		RunsAllowed:        row.RunsAllowed,
		EarnedRuns:         row.EarnedRuns,
		RA9:                row.RA9,
		ERA:                row.ERA,
		WHIP:               row.WHIP,
		StrikeoutWalkRatio: row.StrikeoutWalkRatio,
		WildPitches:        row.WildPitches,
		Balks:              row.Balks,
		Pickoffs:           row.Pickoffs,
		HitBatters:         row.HitBatters,
	}
}

type personFieldingTOML struct {
	Games              int     `toml:"games"`
	Positions          string  `toml:"positions"`
	Putouts            int     `toml:"putouts"`
	Assists            int     `toml:"assists"`
	Errors             int     `toml:"errors"`
	TotalChances       int     `toml:"total_chances"`
	FieldingPercentage float64 `toml:"fielding_percentage"`
	DoublePlays        int     `toml:"double_plays"`
	PassedBalls        int     `toml:"passed_balls"`
	OutfieldAssists    int     `toml:"outfield_assists"`
}

// personFieldingTOMLFrom 转换周期守备统计。
func personFieldingTOMLFrom(row person.FieldingStats) personFieldingTOML {
	return personFieldingTOML{
		Games:              row.Games,
		Positions:          row.Positions,
		Putouts:            row.Putouts,
		Assists:            row.Assists,
		Errors:             row.Errors,
		TotalChances:       row.TotalChances,
		FieldingPercentage: row.FieldingPercentage,
		DoublePlays:        row.DoublePlays,
		PassedBalls:        row.PassedBalls,
		OutfieldAssists:    row.OutfieldAssists,
	}
}

type gameAnalysisListTOML struct {
	Analyses []gameAnalysisListItemTOML `toml:"analyses"`
}

type gameAnalysisListItemTOML struct {
	GameID          int64  `toml:"game_id"`
	Date            string `toml:"date"`
	Opponent        string `toml:"opponent"`
	OwnRuns         int    `toml:"own_runs"`
	OpponentRuns    int    `toml:"opponent_runs"`
	Score           string `toml:"score"`
	Result          string `toml:"result"`
	IsFinal         bool   `toml:"is_final"`
	PlayersAnalyzed int    `toml:"players_analyzed"`
	GeneratedAt     string `toml:"generated_at"`
}

// gameAnalysisListItemTOMLFrom 转换比赛分析列表项。
func gameAnalysisListItemTOMLFrom(row game.GameAnalysisListItem) gameAnalysisListItemTOML {
	return gameAnalysisListItemTOML{
		GameID:          row.GameID,
		Date:            row.Date,
		Opponent:        row.Opponent,
		OwnRuns:         row.OwnRuns,
		OpponentRuns:    row.OpponentRuns,
		Score:           fmt.Sprintf("%d-%d", row.OwnRuns, row.OpponentRuns),
		Result:          formatGameResult(row.Result),
		IsFinal:         row.IsFinal,
		PlayersAnalyzed: row.PlayersAnalyzed,
		GeneratedAt:     row.GeneratedAt,
	}
}

type drillRecommendationListTOML struct {
	Drills []drillRecommendationTOML `toml:"drills"`
}

type drillTrainingListTOML struct {
	Trainings []drillRecommendationTOML `toml:"trainings"`
}

type drillTrainingReadTOML struct {
	Training drillRecommendationTOML `toml:"training"`
}

type drillRecommendationTOML struct {
	ID            int64  `toml:"id"`
	Name          string `toml:"name"`
	Type          string `toml:"type"`
	URL           string `toml:"url"`
	Reason        string `toml:"reason"`
	Summary       string `toml:"summary"`
	IsApproved    bool   `toml:"is_approved"`
	ReviewStatus  string `toml:"review_status"`
	ReviewedBy    string `toml:"reviewed_by"`
	ReviewSummary string `toml:"review_summary"`
	ReviewNote    string `toml:"review_note"`
	ReviewedAt    string `toml:"reviewed_at"`
	CreatedAt     string `toml:"created_at"`
}

// drillRecommendationTOMLFrom 转换训练推荐。
func drillRecommendationTOMLFrom(row drill.Recommendation) drillRecommendationTOML {
	return drillRecommendationTOML{
		ID:            row.ID,
		Name:          row.Name,
		Type:          formatDrillType(row.Type),
		URL:           row.URL,
		Reason:        row.Reason,
		Summary:       row.Summary,
		IsApproved:    row.IsApproved,
		ReviewStatus:  formatReviewStatus(row),
		ReviewedBy:    row.ReviewedBy,
		ReviewSummary: row.ReviewSummary,
		ReviewNote:    row.ReviewNote,
		ReviewedAt:    row.ReviewedAt,
		CreatedAt:     row.CreatedAt,
	}
}

// runnerReasonString 将可选跑垒原因转为可选文本。
func runnerReasonString(value *game.RunnerReason) *string {
	if value == nil {
		return nil
	}
	formatted := formatOptionalRunnerReason(value)
	return &formatted
}

// startingPositionString 将可选守备编号转为可选位置缩写。
func startingPositionString(value *int) *string {
	if value == nil {
		return nil
	}
	formatted := formatOptionalStartingPosition(value)
	return &formatted
}

type stringEnum[T comparable] struct {
	label string
	value T
}

var battingSideOptions = []stringEnum[game.BattingSide]{
	{label: "top", value: game.BattingSideTop},
	{label: "bottom", value: game.BattingSideBottom},
}

var teamOptions = []stringEnum[game.Team]{
	{label: "own", value: game.TeamOwn},
	{label: "opponent", value: game.TeamOpponent},
}

var halfOptions = []stringEnum[game.Half]{
	{label: "top", value: game.HalfTop},
	{label: "bottom", value: game.HalfBottom},
}

var eventKindOptions = []stringEnum[game.EventKind]{
	{label: "plate_result", value: game.EventKindPlateResult},
	{label: "runner_movement", value: game.EventKindRunnerMovement},
	{label: "fielding_credit", value: game.EventKindFieldingCredit},
}

var plateResultOptions = []stringEnum[game.PlateResult]{
	{label: "single", value: game.PlateResultSingle},
	{label: "double", value: game.PlateResultDouble},
	{label: "triple", value: game.PlateResultTriple},
	{label: "homerun", value: game.PlateResultHomerun},
	{label: "walk", value: game.PlateResultWalk},
	{label: "hit_by_pitch", value: game.PlateResultHitByPitch},
	{label: "strikeout", value: game.PlateResultStrikeout},
	{label: "groundout", value: game.PlateResultGroundout},
	{label: "flyout", value: game.PlateResultFlyout},
	{label: "reached_on_error", value: game.PlateResultReachedOnError},
	{label: "fielders_choice", value: game.PlateResultFieldersChoice},
	{label: "sacrifice", value: game.PlateResultSacrifice},
	{label: "other", value: game.PlateResultOther},
}

var runnerResultOptions = []stringEnum[game.RunnerResult]{
	{label: "advance", value: game.RunnerResultAdvance},
	{label: "run_scored", value: game.RunnerResultRunScored},
	{label: "out", value: game.RunnerResultOut},
}

var runnerReasonOptions = []stringEnum[game.RunnerReason]{
	{label: "batted_ball", value: game.RunnerReasonBattedBall},
	{label: "stolen_base", value: game.RunnerReasonStolenBase},
	{label: "caught_stealing", value: game.RunnerReasonCaughtStealing},
	{label: "wild_pitch", value: game.RunnerReasonWildPitch},
	{label: "passed_ball", value: game.RunnerReasonPassedBall},
	{label: "balk", value: game.RunnerReasonBalk},
	{label: "pickoff", value: game.RunnerReasonPickoff},
	{label: "error", value: game.RunnerReasonError},
	{label: "fielders_choice", value: game.RunnerReasonFieldersChoice},
	{label: "other", value: game.RunnerReasonOther},
}

var fieldingResultOptions = []stringEnum[game.FieldingResult]{
	{label: "putout", value: game.FieldingResultPutout},
	{label: "assist", value: game.FieldingResultAssist},
	{label: "error", value: game.FieldingResultError},
	{label: "double_play", value: game.FieldingResultDoublePlay},
	{label: "passed_ball", value: game.FieldingResultPassedBall},
	{label: "outfield_assist", value: game.FieldingResultOutfieldAssist},
	{label: "other", value: game.FieldingResultOther},
}

var gameResultOptions = []stringEnum[game.GameResult]{
	{label: "win", value: game.GameResultWin},
	{label: "loss", value: game.GameResultLoss},
	{label: "tie", value: game.GameResultTie},
	{label: "in_progress", value: game.GameResultInProgress},
}

var startingPositionOptions = []stringEnum[int]{
	{label: "P", value: 1},
	{label: "C", value: 2},
	{label: "1B", value: 3},
	{label: "2B", value: 4},
	{label: "3B", value: 5},
	{label: "SS", value: 6},
	{label: "LF", value: 7},
	{label: "CF", value: 8},
	{label: "RF", value: 9},
}

var drillTypeOptions = []stringEnum[drill.DrillType]{
	{label: "pitching", value: drill.DrillTypePitching},
	{label: "catching", value: drill.DrillTypeCatching},
	{label: "hitting", value: drill.DrillTypeHitting},
	{label: "strength", value: drill.DrillTypeStrength},
	{label: "baserunning", value: drill.DrillTypeBaserunning},
	{label: "infield", value: drill.DrillTypeInfield},
	{label: "outfield", value: drill.DrillTypeOutfield},
}

var reviewStatusOptions = []stringEnum[drill.ReviewStatus]{
	{label: "pending", value: drill.ReviewStatusPending},
	{label: "approved", value: drill.ReviewStatusApproved},
	{label: "rejected", value: drill.ReviewStatusRejected},
}

// parseBattingSide 解析先后攻文本枚举。
func parseBattingSide(raw string) (game.BattingSide, error) {
	return parseStringEnum("--batting-side", raw, battingSideOptions, strings.ToLower)
}

// parseTeam 解析本队或对手文本枚举。
func parseTeam(raw string) (game.Team, error) {
	return parseStringEnum("--team", raw, teamOptions, strings.ToLower)
}

// parseHalf 解析上下半局文本枚举。
func parseHalf(raw string) (game.Half, error) {
	return parseStringEnum("--half", raw, halfOptions, strings.ToLower)
}

// parseEventKind 解析比赛事件大类文本。
func parseEventKind(raw string) (game.EventKind, error) {
	return parseStringEnum("--event-kind", raw, eventKindOptions, strings.ToLower)
}

// parseEventResult 按事件大类解析对应结果文本。
func parseEventResult(kind game.EventKind, raw string) (int, error) {
	switch kind {
	case game.EventKindPlateResult:
		value, err := parseStringEnum("--result", raw, plateResultOptions, strings.ToLower)
		return int(value), err
	case game.EventKindRunnerMovement:
		value, err := parseStringEnum("--result", raw, runnerResultOptions, strings.ToLower)
		return int(value), err
	case game.EventKindFieldingCredit:
		value, err := parseStringEnum("--result", raw, fieldingResultOptions, strings.ToLower)
		return int(value), err
	default:
		return 0, fmt.Errorf("invalid --event-kind %d", kind)
	}
}

// parseRunnerReason 解析跑垒原因文本枚举。
func parseRunnerReason(raw string) (game.RunnerReason, error) {
	return parseStringEnum("--reason", raw, runnerReasonOptions, strings.ToLower)
}

// parseOptionalStartingPosition 解析可选首发位置文本。
func parseOptionalStartingPosition(raw *string) (*int, error) {
	if raw == nil {
		return nil, nil
	}
	value, err := parseStringEnum("--starting-position", *raw, startingPositionOptions, strings.ToUpper)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// parseDrillType 解析训练类型文本枚举。
func parseDrillType(raw string) (drill.DrillType, error) {
	return parseStringEnum("--type", raw, drillTypeOptions, strings.ToLower)
}

// parseOptionalDrillType 解析可选训练类型筛选条件。
func parseOptionalDrillType(raw string) (*drill.DrillType, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	value, err := parseDrillType(raw)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// parseOptionalReviewStatus 解析可选审核状态筛选条件。
func parseOptionalReviewStatus(raw string) (*drill.ReviewStatus, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	value, err := parseStringEnum("--status", raw, reviewStatusOptions, strings.ToLower)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// parseStringEnum 将文本匹配为枚举值，并生成统一错误提示。
func parseStringEnum[T comparable](flag string, raw string, options []stringEnum[T], normalize func(string) string) (T, error) {
	value := normalize(strings.TrimSpace(raw))
	for _, option := range options {
		if value == normalize(option.label) {
			return option.value, nil
		}
	}
	var zero T
	return zero, fmt.Errorf("invalid %s %q, expected one of: %s", flag, raw, enumLabels(options))
}

// enumLabels 汇总枚举选项标签，用于错误提示。
func enumLabels[T comparable](options []stringEnum[T]) string {
	labels := make([]string, 0, len(options))
	for _, option := range options {
		labels = append(labels, option.label)
	}
	return strings.Join(labels, ",")
}

// formatBattingSide 格式化先后攻枚举。
func formatBattingSide(value game.BattingSide) string {
	return formatStringEnum(value, battingSideOptions)
}

// formatTeam 格式化球队枚举。
func formatTeam(value game.Team) string {
	return formatStringEnum(value, teamOptions)
}

// formatHalf 格式化半局枚举。
func formatHalf(value game.Half) string {
	return formatStringEnum(value, halfOptions)
}

// formatEventKind 格式化比赛事件大类。
func formatEventKind(value game.EventKind) string {
	return formatStringEnum(value, eventKindOptions)
}

// formatEventResult 按事件类型格式化结果枚举。
func formatEventResult(kind game.EventKind, value int) string {
	switch kind {
	case game.EventKindPlateResult:
		return formatStringEnum(game.PlateResult(value), plateResultOptions)
	case game.EventKindRunnerMovement:
		return formatStringEnum(game.RunnerResult(value), runnerResultOptions)
	case game.EventKindFieldingCredit:
		return formatStringEnum(game.FieldingResult(value), fieldingResultOptions)
	default:
		return fmt.Sprintf("%d", value)
	}
}

// formatOptionalRunnerReason 格式化可选跑垒原因。
func formatOptionalRunnerReason(value *game.RunnerReason) string {
	if value == nil {
		return ""
	}
	return formatStringEnum(*value, runnerReasonOptions)
}

// formatOptionalStartingPosition 格式化可选首发位置。
func formatOptionalStartingPosition(value *int) string {
	if value == nil {
		return ""
	}
	return formatStringEnum(*value, startingPositionOptions)
}

// formatDrillType 格式化训练类型枚举。
func formatDrillType(value drill.DrillType) string {
	return formatStringEnum(value, drillTypeOptions)
}

// formatReviewStatus 从推荐记录推导并格式化审核状态。
func formatReviewStatus(row drill.Recommendation) string {
	return formatStringEnum(row.ReviewStatus(), reviewStatusOptions)
}

// formatGameResult 格式化比赛结果枚举。
func formatGameResult(value game.GameResult) string {
	return formatStringEnum(value, gameResultOptions)
}

// formatStringEnum 将枚举值反查为文本标签。
func formatStringEnum[T comparable](value T, options []stringEnum[T]) string {
	for _, option := range options {
		if value == option.value {
			return option.label
		}
	}
	return fmt.Sprintf("%v", value)
}
