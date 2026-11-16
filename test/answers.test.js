import test from 'node:test'; import assert from 'node:assert/strict';
import { permissionAllow, permissionDeny, choiceAnswer, stopReply, RELEASE } from '../src/main/answers.js';

test('allow without rule', () => assert.deepEqual(permissionAllow(),
  { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));
test('allow with always-rule passes suggestions through', () => {
  const s = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }];
  assert.deepEqual(permissionAllow(s).hookSpecificOutput.decision, { behavior: 'allow', updatedPermissions: s });
});
test('deny has default message', () => assert.deepEqual(permissionDeny().hookSpecificOutput.decision,
  { behavior: 'deny', message: 'Denied from Agent HUD' }));
test('choice keeps questions and adds answers', () => {
  const ti = { questions: [{ question: 'Delete old builds?', header: 'Updater', multiSelect: false, options: [{ label: 'Keep the last 3', description: '' }, { label: 'Leave them', description: '' }] }] };
  assert.deepEqual(choiceAnswer(ti, { 'Delete old builds?': 'Keep the last 3' }), { hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'allow',
    updatedInput: { ...ti, answers: { 'Delete old builds?': 'Keep the last 3' } } } });
});
test('multi-select answers use the format recorded in SPIKES.md', () => {
  // Default ', '-joined string; switch to array if spike 2 showed only arrays work.
  const ti = { questions: [{ question: 'Which?', header: 'X', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }] };
  assert.equal(choiceAnswer(ti, { 'Which?': ['A', 'B'] }).hookSpecificOutput.updatedInput.answers['Which?'], 'A, B');
});
test('stop reply blocks with text', () => assert.deepEqual(stopReply('Yes, start with the weekly view'),
  { decision: 'block', reason: 'Yes, start with the weekly view' }));
test('release is null', () => assert.equal(RELEASE, null));
test('choice does not mutate toolInput', () => {
  const ti = { questions: [{ question: 'Pick?', header: 'H', multiSelect: false, options: [{ label: 'A' }] }] };
  const before = structuredClone(ti);
  choiceAnswer(ti, { 'Pick?': 'A' });
  assert.deepEqual(ti, before);
  assert.equal('answers' in ti, false);
});
