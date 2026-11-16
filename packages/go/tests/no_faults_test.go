//go:build !polyspec_php_serialization_fault_test

package tests

import "testing"

// Without the build tag polyspec_php_serialization_fault_test the binding has no entry point to arm a fault, so a case that arms one
// fails here instead of passing unarmed: make test-go builds with the tag of each test feature of the crate.
func armFaults(t *testing.T, _, _ string) (uint64, error) {
	t.Fatal("the case arms faults, which needs the build tag polyspec_php_serialization_fault_test of the feature fault-test")
	return 0, nil
}

func faultLeft(uint64) ([]string, error) { return nil, nil }
