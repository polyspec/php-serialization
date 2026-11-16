//go:build polyspec_php_serialization_fault_test

package tests

import (
	"testing"

	"github.com/polyspec/php-serialization/packages/go/internal/binding"
)

// armFaults and faultLeft are the entry points of the feature fault-test (binding GN-5), which the build tag
// polyspec_php_serialization_fault_test compiles.
func armFaults(_ *testing.T, member, faults string) (uint64, error) {
	return binding.ArmFaults(member, faults)
}

func faultLeft(id uint64) ([]string, error) { return binding.FaultLeft(id) }
