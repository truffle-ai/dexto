# Post-Phase-2 Testing Plan

Manual testing plan to validate the path resolution cleanup and execution context consolidation after completing Phase 2.5 of the agent registry system.

## Test Environment Setup

### Prerequisites
- Build completed: `npm run build`
- All unit tests passing: `npm run test:unit`
- TypeScript compilation successful: `npm run typecheck`

## Testing Categories

### 1. Basic CLI Functionality

#### Test 1.1: CLI Help and Version
```bash
# Verify basic CLI still works
./dist/src/app/index.js --help
./dist/src/app/index.js --version
```
**Expected**: Help text displays, version shows, no errors

#### Test 1.2: Bundled Agent in Dexto Source
```bash
# In dexto source directory (current location)
./dist/src/app/index.js "test message"
```
**Expected**: Uses bundled `agents/default-agent.yml`, no errors

### 2. Execution Context Detection

#### Test 2.1: Dexto Source Context
```bash
# Should detect dexto-source context
cd /Users/karaj/Projects/dexto
./dist/src/app/index.js "what context am I in?"
```
**Expected**: Uses `agents/default-agent.yml` from repo

#### Test 2.2: Global CLI Context  
```bash
# Should detect global-cli context
cd ~/Desktop
/Users/karaj/Projects/dexto/dist/src/app/index.js "what context am I in?"
```
**Expected**: Error message about missing global preferences (setup needed)

#### Test 2.3: Dexto Project Context
```bash
# Create a test dexto project
mkdir -p /tmp/test-dexto-project
cd /tmp/test-dexto-project
echo '{"name": "test-project", "dependencies": {"dexto": "^1.0.0"}}' > package.json

# Should detect dexto-project context
/Users/karaj/Projects/dexto/dist/src/app/index.js "what context am I in?"
```
**Expected**: Error message about missing project default-agent.yml or global preferences

### 3. Agent Resolution with Explicit Paths

#### Test 3.1: Absolute Path Resolution
```bash
# Test with absolute path to bundled agent
./dist/src/app/index.js --agent /Users/karaj/Projects/dexto/agents/default-agent.yml "test"
```
**Expected**: Uses specified agent, no errors

#### Test 3.2: Relative Path Resolution
```bash
# Test with relative path
./dist/src/app/index.js --agent ./agents/default-agent.yml "test"
```
**Expected**: Uses specified agent, no errors

#### Test 3.3: Non-existent Path
```bash
# Test with non-existent file
./dist/src/app/index.js --agent ./non-existent.yml "test"
```
**Expected**: Clear error message about file not found

### 4. Error Scenarios and Messaging

#### Test 4.1: Missing Bundled Agent
```bash
# Temporarily move bundled agent to test error
mv agents/default-agent.yml agents/default-agent.yml.backup
./dist/src/app/index.js "test"
mv agents/default-agent.yml.backup agents/default-agent.yml
```
**Expected**: Clear error about bundled agent missing, suggestion to run build

#### Test 4.2: First-Time User Experience
```bash
# Simulate first-time user (no preferences)
cd ~/Desktop
/Users/karaj/Projects/dexto/dist/src/app/index.js "hello"
```
**Expected**: Helpful first-time setup message, guidance to run `dexto setup`

#### Test 4.3: Project Without Default Agent
```bash
# Test project context without default agent
cd /tmp/test-dexto-project
/Users/karaj/Projects/dexto/dist/src/app/index.js "test"
```
**Expected**: Clear error about missing project default or global preferences

### 5. Registry Agent Names (Future)

#### Test 5.1: Valid Registry Agent
```bash
# This will fail until agent registry is implemented
./dist/src/app/index.js --agent database-agent "test"
```
**Expected**: Error about agent registry not being installed/configured

#### Test 5.2: Invalid Registry Agent
```bash
# This will fail until agent registry is implemented  
./dist/src/app/index.js --agent non-existent-agent "test"
```
**Expected**: Error about agent not found in registry

## Integration Testing

### Test 6.1: Full Test Suite
```bash
# Run complete test suite
npm test
npm run test:integ
```
**Expected**: All tests pass (except known failing registry.test.ts)

### Test 6.2: Build and Type Verification
```bash
# Verify clean build and types
npm run clean
npm run build
npm run typecheck
npm run lint
```
**Expected**: All commands succeed without errors

## Success Criteria

### Must Pass
- [ ] CLI help/version works
- [ ] Bundled agent resolution works in dexto-source context
- [ ] Context detection works correctly for all three contexts
- [ ] Explicit file path resolution works (absolute and relative)
- [ ] Error messages are clear and actionable
- [ ] All quality checks pass (build, test, typecheck, lint)

### Should Pass  
- [ ] First-time user gets helpful setup guidance
- [ ] Project context shows appropriate error when no default agent
- [ ] Non-existent file paths show clear error messages

### Expected to Fail (Until Phase 3)
- [ ] Registry agent resolution (agent registry not implemented yet)
- [ ] Global CLI with preferences (preferences system not wired up yet)
- [ ] Setup command (not implemented yet)

## Known Issues to Track

### Current Limitations
- Agent registry resolution will fail (not implemented)
- Global preferences system not wired to CLI entry point
- Setup command not implemented
- Multi-agent systems not supported

### Post-Testing Actions
Based on test results:
1. Document any unexpected behaviors
2. Create issues for critical problems
3. Update feature plan if priorities need adjustment
4. Proceed to Phase 3 implementation

## Testing Notes

### File Locations
- **Bundled agent**: `agents/default-agent.yml`
- **Test directories**: Use `/tmp/` for temporary testing
- **CLI binary**: `./dist/src/app/index.js`

### Context Detection Logic
- **dexto-source**: `package.json` name === "dexto"
- **dexto-project**: `package.json` has dexto dependency, name !== "dexto"  
- **global-cli**: No dexto project found in directory tree

This testing plan validates that the path resolution refactoring works correctly across all execution contexts and provides clear feedback for the next development phase.