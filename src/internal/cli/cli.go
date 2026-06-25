package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"bastion/internal/domain/drill"
	"bastion/internal/domain/game"
	"bastion/internal/domain/player"
	"bastion/internal/domain/report"
	"bastion/internal/sqlite"

	"github.com/alecthomas/kong"
	"github.com/pelletier/go-toml/v2"
)

type CLI struct {
	DB     string    `help:"Path to the SQLite database." default:"bastion.db" placeholder:"PATH"`
	Player PlayerCmd `cmd:"" help:"Manage players."`
	Report ReportCmd `cmd:"" help:"Manage training reports."`
	Game   GameCmd   `cmd:"" help:"Manage games."`
	Drill  DrillCmd  `cmd:"" help:"Manage drill recommendations."`
}

type PlayerCmd struct {
	Add  PlayerAddCmd  `cmd:"" help:"Add a player."`
	Read PlayerReadCmd `cmd:"" help:"Read a player by name."`
}

type PlayerAddCmd struct {
	Name      string `required:"" help:"Player name; cannot be empty."`
	Number    int    `required:"" help:"Jersey number, >= 0."`
	Bat       string `required:"" help:"Batting hand(s): left,right. Use comma for multiple values, for example left,right."`
	Throw     string `name:"throw" required:"" help:"Throwing hand(s): left,right. Use comma for multiple values, for example right."`
	Positions string `required:"" help:"Positions: pitcher,catcher,infield,outfield. Use comma for multiple values."`
}

type PlayerReadCmd struct {
	Name string `required:"" help:"Player name to read."`
}

type ReportCmd struct {
	Write ReportWriteCmd `cmd:"" help:"Write a training report."`
	Read  ReportReadCmd  `cmd:"" help:"Read a training report."`
}

type ReportWriteCmd struct {
	Name       string `required:"" help:"Player name; cannot be empty."`
	Date       string `required:"" help:"Training date, formatted as YYYY-MM-DD."`
	Content    string `required:"" help:"Training content; cannot be empty."`
	Reflection string `required:"" help:"Training reflection; cannot be empty."`
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
	Date          string `required:"" help:"Game date, formatted as YYYY-MM-DD."`
	StartTime     string `help:"Game start time, formatted as HH:MM; omit when unknown."`
	Opponent      string `required:"" help:"Opponent name; cannot be empty."`
	BattingSide   string `required:"" help:"Own batting side: top,bottom."`
	OwnScore      int    `required:"" help:"Own final score, >= 0."`
	OpponentScore int    `required:"" help:"Opponent final score, >= 0."`
	Raw           string `required:"" help:"Raw natural language game description; cannot be empty."`
	LineupJSON    string `name:"lineup-json" default:"[]" help:"JSON array of lineup records. team: own,opponent. starting_position: P,C,1B,2B,3B,SS,LF,CF,RF."`
	EventsJSON    string `name:"events-json" default:"[]" help:"JSON array of game fact events. event_kind: plate_result,runner_movement,fielding_credit."`
}

type GameCreateCmd struct {
	Date        string `required:"" help:"Game date, formatted as YYYY-MM-DD."`
	StartTime   string `help:"Game start time, formatted as HH:MM; omit when unknown."`
	Opponent    string `required:"" help:"Opponent name; cannot be empty."`
	BattingSide string `required:"" help:"Own batting side: top,bottom."`
	Raw         string `required:"" help:"Raw natural language game description; cannot be empty."`
}

type GameLineupCmd struct {
	Add GameLineupAddCmd `cmd:"" help:"Add a lineup record."`
}

type GameLineupAddCmd struct {
	GameID           int64   `required:"" help:"Game id, > 0."`
	Team             string  `required:"" help:"Team: own,opponent."`
	Player           string  `required:"" help:"Player name; cannot be empty."`
	BattingOrder     *int    `help:"Batting order, 1-9; omit for substitute or unknown."`
	StartingPosition *string `help:"Starting position: P,C,1B,2B,3B,SS,LF,CF,RF. Omit for non-starter or unknown."`
}

type GameEventCmd struct {
	Write GameEventWriteCmd `cmd:"" help:"Write game fact events."`
}

type GameEventWriteCmd struct {
	GameID     int64  `required:"" help:"Game id to append events to; must exist."`
	EventsJSON string `name:"events-json" required:"" help:"JSON array of game fact events; supports plate_result, runner_movement, and fielding_credit."`
}

type GameScoreCmd struct {
	Set GameScoreSetCmd `cmd:"" help:"Set final score."`
}

type GameScoreSetCmd struct {
	GameID        int64 `required:"" help:"Game id, > 0."`
	OwnScore      int   `required:"" help:"Own final score, >= 0."`
	OpponentScore int   `required:"" help:"Opponent final score, >= 0."`
}

type GameAnalysisCmd struct {
	Generate GameAnalysisGenerateCmd `cmd:"" help:"Generate player performance analysis."`
	Read     GameAnalysisReadCmd     `cmd:"" help:"Read generated player performance analysis."`
	List     GameAnalysisListCmd     `cmd:"" help:"List games with generated analysis."`
}

type GameAnalysisGenerateCmd struct {
	GameID int64 `required:"" help:"Game id to generate analysis for; must exist and have analyzable events."`
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

type DrillCmd struct {
	Recommend DrillRecommendCmd `cmd:"" help:"Manage drill recommendations."`
}

type DrillRecommendCmd struct {
	Write DrillWriteCmd `cmd:"" help:"Write a drill recommendation."`
	List  DrillListCmd  `cmd:"" help:"List drill recommendations."`
}

type DrillWriteCmd struct {
	Name    string `required:"" help:"Recommender name; must be a registered player."`
	URL     string `name:"url" required:"" help:"Video URL; cannot be empty."`
	Reason  string `required:"" help:"Recommendation reason; cannot be empty."`
	Type    string `required:"" help:"Drill type: pitching,catching,hitting,strength,baserunning,infield,outfield."`
	Summary string `required:"" help:"AI-generated summary; cannot be empty."`
}

type DrillListCmd struct {
	Name string `help:"Filter by recommender name."`
	Type string `help:"Filter by drill type: pitching,catching,hitting,strength,baserunning,infield,outfield."`
}

type Context struct {
	PlayerService *player.Service
	ReportService *report.Service
	GameService   *game.Service
	DrillService  *drill.Service
	Out           io.Writer
}

func Run(args []string, stdout io.Writer, stderr io.Writer) error {
	var app CLI
	parser := kong.Must(
		&app,
		kong.Name("bastion"),
		kong.Description("Baseball player self-training registration CLI."),
		kong.Writers(stdout, stderr),
	)

	ctx, err := parser.Parse(args)
	if err != nil {
		return err
	}

	store, err := sqlite.Open(app.DB)
	if err != nil {
		return err
	}
	defer store.Close()

	if err := store.Init(); err != nil {
		return err
	}

	return ctx.Run(&Context{
		PlayerService: player.NewService(store),
		ReportService: report.NewService(store),
		GameService:   game.NewService(store),
		DrillService:  drill.NewService(store),
		Out:           stdout,
	})
}

func (cmd *PlayerAddCmd) Run(ctx *Context) error {
	player, err := ctx.PlayerService.AddPlayer(cmd.Name, cmd.Number, cmd.Bat, cmd.Throw, cmd.Positions)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "player added: %s\n", player.Name)
	return nil
}

func (cmd *PlayerReadCmd) Run(ctx *Context) error {
	player, err := ctx.PlayerService.GetPlayer(cmd.Name)
	if err != nil {
		return err
	}
	printPlayer(ctx.Out, player)
	return nil
}

func (cmd *ReportWriteCmd) Run(ctx *Context) error {
	report, err := ctx.ReportService.WriteReport(cmd.Name, cmd.Date, cmd.Content, cmd.Reflection)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "report saved: %s %s\n", report.Name, report.Date)
	return nil
}

func (cmd *ReportReadCmd) Run(ctx *Context) error {
	report, err := ctx.ReportService.GetReport(cmd.Name, cmd.Date)
	if err != nil {
		return err
	}
	printReport(ctx.Out, report)
	return nil
}

func (cmd *GameWriteCmd) Run(ctx *Context) error {
	battingSide, err := parseBattingSide(cmd.BattingSide)
	if err != nil {
		return err
	}
	lineups, err := parseLineupsJSON(cmd.LineupJSON)
	if err != nil {
		return err
	}
	events, err := parseEventsJSON(cmd.EventsJSON)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.WriteGame(
		cmd.Date,
		cmd.StartTime,
		cmd.Opponent,
		battingSide,
		cmd.OwnScore,
		cmd.OpponentScore,
		cmd.Raw,
		lineups,
		events,
	)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "game saved: %d\n", id)
	return nil
}

func (cmd *GameCreateCmd) Run(ctx *Context) error {
	battingSide, err := parseBattingSide(cmd.BattingSide)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.CreateGame(cmd.Date, cmd.StartTime, cmd.Opponent, battingSide, cmd.Raw)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "game created: %d\n", id)
	return nil
}

func (cmd *GameLineupAddCmd) Run(ctx *Context) error {
	team, err := parseTeam(cmd.Team)
	if err != nil {
		return err
	}
	startingPosition, err := parseOptionalStartingPosition(cmd.StartingPosition)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.AddGameLineup(cmd.GameID, team, cmd.Player, cmd.BattingOrder, startingPosition)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "lineup added: %d\n", id)
	return nil
}

func (cmd *GameEventWriteCmd) Run(ctx *Context) error {
	events, err := parseEventsJSON(cmd.EventsJSON)
	if err != nil {
		return err
	}
	count, err := ctx.GameService.WriteGameEvents(cmd.GameID, events)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "game events saved: %d\n", count)
	return nil
}

func (cmd *GameScoreSetCmd) Run(ctx *Context) error {
	if err := ctx.GameService.SetGameScore(cmd.GameID, cmd.OwnScore, cmd.OpponentScore); err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "score saved: %d\n", cmd.GameID)
	return nil
}

func (cmd *GameAnalysisGenerateCmd) Run(ctx *Context) error {
	id, err := ctx.GameService.GenerateGameAnalysis(cmd.GameID)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "game analysis generated: %d\n", id)
	return nil
}

func (cmd *GameAnalysisReadCmd) Run(ctx *Context) error {
	analysis, err := ctx.GameService.ReadGameAnalysis(cmd.GameID, cmd.Player)
	if err != nil {
		return err
	}
	printGameAnalysis(ctx.Out, analysis)
	return nil
}

func (cmd *GameAnalysisListCmd) Run(ctx *Context) error {
	items, err := ctx.GameService.ListGameAnalyses()
	if err != nil {
		return err
	}
	printGameAnalysisList(ctx.Out, items)
	return nil
}

func (cmd *GameReadCmd) Run(ctx *Context) error {
	details, err := ctx.GameService.GetGame(cmd.ID)
	if err != nil {
		return err
	}
	printGameDetails(ctx.Out, details)
	return nil
}

func (cmd *GameListCmd) Run(ctx *Context) error {
	games, err := ctx.GameService.ListGames(cmd.Date)
	if err != nil {
		return err
	}
	printGameList(ctx.Out, games)
	return nil
}

func (cmd *DrillWriteCmd) Run(ctx *Context) error {
	drillType, err := parseDrillType(cmd.Type)
	if err != nil {
		return err
	}
	id, err := ctx.DrillService.WriteRecommendation(cmd.Name, cmd.URL, cmd.Reason, drillType, cmd.Summary)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "drill recommendation saved: %d\n", id)
	return nil
}

func (cmd *DrillListCmd) Run(ctx *Context) error {
	drillType, err := parseOptionalDrillType(cmd.Type)
	if err != nil {
		return err
	}
	recommendations, err := ctx.DrillService.ListRecommendations(drill.ListFilter{
		Name: cmd.Name,
		Type: drillType,
	})
	if err != nil {
		return err
	}
	printDrillRecommendationList(ctx.Out, recommendations)
	return nil
}

func printPlayer(out io.Writer, p player.Player) {
	writeTOML(out, playerReadTOML{Player: playerTOMLFrom(p)})
}

func printReport(out io.Writer, report report.Report) {
	writeTOML(out, reportReadTOML{Report: reportTOMLFrom(report)})
}

func writeTOML(out io.Writer, value any) {
	data, err := toml.Marshal(value)
	if err != nil {
		panic(fmt.Sprintf("marshal CLI output as TOML: %v", err))
	}
	fmt.Fprint(out, string(data))
}

type playerReadTOML struct {
	Player playerTOML `toml:"player"`
}

type playerTOML struct {
	Name      string `toml:"name"`
	Number    int    `toml:"number"`
	Bat       string `toml:"bat"`
	Throw     string `toml:"throw"`
	Positions string `toml:"positions"`
}

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

func reportTOMLFrom(r report.Report) reportTOML {
	return reportTOML{
		Name:       r.Name,
		Date:       r.Date,
		Content:    r.Content,
		Reflection: r.Reflection,
	}
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

func parseLineupsJSON(raw string) ([]game.GameLineup, error) {
	var records []lineupJSON
	if err := json.Unmarshal([]byte(raw), &records); err != nil {
		return nil, fmt.Errorf("invalid --lineup-json: %w", err)
	}
	lineups := make([]game.GameLineup, 0, len(records))
	for i, record := range records {
		team, err := parseTeam(record.Team)
		if err != nil {
			return nil, fmt.Errorf("invalid --lineup-json item %d: %w", i+1, err)
		}
		startingPosition, err := parseOptionalStartingPosition(record.StartingPosition)
		if err != nil {
			return nil, fmt.Errorf("invalid --lineup-json item %d: %w", i+1, err)
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

func parseEventsJSON(raw string) ([]game.GameEvent, error) {
	var records []eventJSON
	if err := json.Unmarshal([]byte(raw), &records); err != nil {
		return nil, fmt.Errorf("invalid --events-json: %w", err)
	}
	events := make([]game.GameEvent, 0, len(records))
	for i, record := range records {
		half, err := parseHalf(record.Half)
		if err != nil {
			return nil, fmt.Errorf("invalid --events-json item %d: %w", i+1, err)
		}
		kind, err := parseEventKind(record.EventKind)
		if err != nil {
			return nil, fmt.Errorf("invalid --events-json item %d: %w", i+1, err)
		}
		team, err := parseTeam(record.Team)
		if err != nil {
			return nil, fmt.Errorf("invalid --events-json item %d: %w", i+1, err)
		}
		result, err := parseEventResult(kind, record.Result)
		if err != nil {
			return nil, fmt.Errorf("invalid --events-json item %d: %w", i+1, err)
		}
		var reason *game.RunnerReason
		if record.Reason != nil && strings.TrimSpace(*record.Reason) != "" {
			parsed, err := parseRunnerReason(*record.Reason)
			if err != nil {
				return nil, fmt.Errorf("invalid --events-json item %d: %w", i+1, err)
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

func printGameDetails(out io.Writer, details game.GameDetails) {
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
	writeTOML(out, output)
}

func printGameList(out io.Writer, games []game.Game) {
	if len(games) == 0 {
		return
	}
	output := gameListTOML{Games: make([]gameTOML, 0, len(games))}
	for _, row := range games {
		output.Games = append(output.Games, gameTOMLFrom(row))
	}
	writeTOML(out, output)
}

func printGameAnalysis(out io.Writer, result game.GameAnalysisResult) {
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
	writeTOML(out, output)
}

func printGameAnalysisList(out io.Writer, items []game.GameAnalysisListItem) {
	if len(items) == 0 {
		return
	}
	output := gameAnalysisListTOML{Analyses: make([]gameAnalysisListItemTOML, 0, len(items))}
	for _, row := range items {
		output.Analyses = append(output.Analyses, gameAnalysisListItemTOMLFrom(row))
	}
	writeTOML(out, output)
}

func printDrillRecommendationList(out io.Writer, recommendations []drill.Recommendation) {
	if len(recommendations) == 0 {
		return
	}
	output := drillRecommendationListTOML{Drills: make([]drillRecommendationTOML, 0, len(recommendations))}
	for _, row := range recommendations {
		output.Drills = append(output.Drills, drillRecommendationTOMLFrom(row))
	}
	writeTOML(out, output)
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

func dataGapTOMLFrom(row game.AnalysisDataGap) dataGapTOML {
	return dataGapTOML{
		Scope:   row.Scope,
		Message: row.Message,
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

type drillRecommendationTOML struct {
	ID        int64  `toml:"id"`
	Name      string `toml:"name"`
	Type      string `toml:"type"`
	URL       string `toml:"url"`
	Reason    string `toml:"reason"`
	Summary   string `toml:"summary"`
	CreatedAt string `toml:"created_at"`
}

func drillRecommendationTOMLFrom(row drill.Recommendation) drillRecommendationTOML {
	return drillRecommendationTOML{
		ID:        row.ID,
		Name:      row.Name,
		Type:      formatDrillType(row.Type),
		URL:       row.URL,
		Reason:    row.Reason,
		Summary:   row.Summary,
		CreatedAt: row.CreatedAt,
	}
}

func runnerReasonString(value *game.RunnerReason) *string {
	if value == nil {
		return nil
	}
	formatted := formatOptionalRunnerReason(value)
	return &formatted
}

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

func parseBattingSide(raw string) (game.BattingSide, error) {
	return parseStringEnum("--batting-side", raw, battingSideOptions, strings.ToLower)
}

func parseTeam(raw string) (game.Team, error) {
	return parseStringEnum("--team", raw, teamOptions, strings.ToLower)
}

func parseHalf(raw string) (game.Half, error) {
	return parseStringEnum("--half", raw, halfOptions, strings.ToLower)
}

func parseEventKind(raw string) (game.EventKind, error) {
	return parseStringEnum("--event-kind", raw, eventKindOptions, strings.ToLower)
}

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

func parseRunnerReason(raw string) (game.RunnerReason, error) {
	return parseStringEnum("--reason", raw, runnerReasonOptions, strings.ToLower)
}

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

func parseDrillType(raw string) (drill.DrillType, error) {
	return parseStringEnum("--type", raw, drillTypeOptions, strings.ToLower)
}

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

func enumLabels[T comparable](options []stringEnum[T]) string {
	labels := make([]string, 0, len(options))
	for _, option := range options {
		labels = append(labels, option.label)
	}
	return strings.Join(labels, ",")
}

func formatBattingSide(value game.BattingSide) string {
	return formatStringEnum(value, battingSideOptions)
}

func formatTeam(value game.Team) string {
	return formatStringEnum(value, teamOptions)
}

func formatHalf(value game.Half) string {
	return formatStringEnum(value, halfOptions)
}

func formatEventKind(value game.EventKind) string {
	return formatStringEnum(value, eventKindOptions)
}

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

func formatOptionalRunnerReason(value *game.RunnerReason) string {
	if value == nil {
		return ""
	}
	return formatStringEnum(*value, runnerReasonOptions)
}

func formatOptionalStartingPosition(value *int) string {
	if value == nil {
		return ""
	}
	return formatStringEnum(*value, startingPositionOptions)
}

func formatDrillType(value drill.DrillType) string {
	return formatStringEnum(value, drillTypeOptions)
}

func formatGameResult(value game.GameResult) string {
	return formatStringEnum(value, gameResultOptions)
}

func formatStringEnum[T comparable](value T, options []stringEnum[T]) string {
	for _, option := range options {
		if value == option.value {
			return option.label
		}
	}
	return fmt.Sprintf("%v", value)
}
