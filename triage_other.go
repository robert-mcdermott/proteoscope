//go:build !linux

package main

import "syscall"

// Only Linux can tie the hidden browser's life to Proteoscope's; elsewhere signals end the run
// through its cleanup.
func browserProcessAttributes() *syscall.SysProcAttr {
	return nil
}
