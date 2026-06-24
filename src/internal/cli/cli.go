package cli

import (
	"fmt"
	"io"

	"bastion/internal/domain"
	"bastion/internal/sqlite"

	"github.com/alecthomas/kong"
)

type CLI struct {
	DB     string    `help:"Path to the SQLite database." default:"bastion.db"`
	Player PlayerCmd `cmd:"" help:"Manage players."`
	Report ReportCmd `cmd:"" help:"Manage training reports."`
}

type PlayerCmd struct {
	Add  PlayerAddCmd  `cmd:"" help:"Add a player."`
	Read PlayerReadCmd `cmd:"" help:"Read a player by name."`
}

type PlayerAddCmd struct {
	Name      string `required:"" help:"Player name."`
	Number    int    `required:"" help:"Jersey number."`
	Bat       string `required:"" help:"Comma-separated batting hands: left,right."`
	Throw     string `name:"throw" required:"" help:"Comma-separated throwing hands: left,right."`
	Positions string `required:"" help:"Comma-separated positions: pitcher,catcher,infield,outfield."`
}

type PlayerReadCmd struct {
	Name string `required:"" help:"Player name."`
}

type ReportCmd struct {
	Write ReportWriteCmd `cmd:"" help:"Write a training report."`
	Read  ReportReadCmd  `cmd:"" help:"Read a training report."`
}

type ReportWriteCmd struct {
	Name       string `required:"" help:"Player name."`
	Date       string `required:"" help:"Training date, formatted as YYYY-MM-DD."`
	Content    string `required:"" help:"Training content."`
	Reflection string `required:"" help:"Training reflection."`
}

type ReportReadCmd struct {
	Name string `required:"" help:"Player name."`
	Date string `required:"" help:"Training date, formatted as YYYY-MM-DD."`
}

type Context struct {
	Service *domain.Service
	Out     io.Writer
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

	service := domain.NewService(store)
	return ctx.Run(&Context{Service: service, Out: stdout})
}

func (cmd *PlayerAddCmd) Run(ctx *Context) error {
	player, err := ctx.Service.AddPlayer(cmd.Name, cmd.Number, cmd.Bat, cmd.Throw, cmd.Positions)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "player added: %s\n", player.Name)
	return nil
}

func (cmd *PlayerReadCmd) Run(ctx *Context) error {
	player, err := ctx.Service.GetPlayer(cmd.Name)
	if err != nil {
		return err
	}
	printPlayer(ctx.Out, player)
	return nil
}

func (cmd *ReportWriteCmd) Run(ctx *Context) error {
	report, err := ctx.Service.WriteReport(cmd.Name, cmd.Date, cmd.Content, cmd.Reflection)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "report saved: %s %s\n", report.Name, report.Date)
	return nil
}

func (cmd *ReportReadCmd) Run(ctx *Context) error {
	report, err := ctx.Service.GetReport(cmd.Name, cmd.Date)
	if err != nil {
		return err
	}
	printReport(ctx.Out, report)
	return nil
}

func printPlayer(out io.Writer, player domain.Player) {
	fmt.Fprintf(out, "name: %s\n", player.Name)
	fmt.Fprintf(out, "number: %d\n", player.Number)
	fmt.Fprintf(out, "bat: %s\n", domain.FormatHands(player.Bat))
	fmt.Fprintf(out, "throw: %s\n", domain.FormatHands(player.Throw))
	fmt.Fprintf(out, "positions: %s\n", domain.FormatPositions(player.Positions))
}

func printReport(out io.Writer, report domain.Report) {
	fmt.Fprintf(out, "name: %s\n", report.Name)
	fmt.Fprintf(out, "date: %s\n", report.Date)
	fmt.Fprintf(out, "content: %s\n", report.Content)
	fmt.Fprintf(out, "reflection: %s\n", report.Reflection)
}
