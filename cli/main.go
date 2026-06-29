package main

import (
	"fmt"
	"os"

	"bastion/internal/cli"
)

// main 将命令行参数交给 CLI，并将失败原因输出到标准错误。
func main() {
	if err := cli.Run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
