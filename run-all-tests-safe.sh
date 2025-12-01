#!/bin/bash
# Run all test fixtures with pauses to prevent editor crashes

echo "=== Running All Fixture Tests (with 3s pauses) ==="
echo ""

TESTS_DIR="tests"
PASSED=0
FAILED=0
FAILED_TESTS=()

# Find all test files
TEST_FILES=$(find "$TESTS_DIR" -name "test-*.cjs" -type f | sort)
TOTAL=$(echo "$TEST_FILES" | wc -l | tr -d ' ')

echo "Found $TOTAL test files"
echo ""

COUNT=0
for test_file in $TEST_FILES; do
  COUNT=$((COUNT + 1))
  test_name=$(basename "$test_file")
  
  echo "[$COUNT/$TOTAL] Running: $test_name"
  echo "----------------------------------------"
  
  # Run test and capture output and exit code
  if node "$test_file" 2>&1 | tail -20; then
    PASSED=$((PASSED + 1))
    echo "✅ PASSED: $test_name"
  else
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("$test_name")
    echo "❌ FAILED: $test_name"
  fi
  
  echo ""
  
  # Pause between tests to prevent overwhelming the editor
  if [ $COUNT -lt $TOTAL ]; then
    echo "Pausing 3 seconds before next test..."
    sleep 3
    echo ""
  fi
done

echo "========================================"
echo "Test Results Summary"
echo "========================================"
echo "Total:  $TOTAL"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -gt 0 ]; then
  echo "Failed tests:"
  for failed_test in "${FAILED_TESTS[@]}"; do
    echo "  - $failed_test"
  done
  exit 1
else
  echo "🎉 All tests passed!"
  exit 0
fi
