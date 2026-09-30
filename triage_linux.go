package main

import "syscall"

// The hidden browser is killed with Proteoscope, even when Proteoscope itself is killed outright.
func browserProcessAttributes() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}
