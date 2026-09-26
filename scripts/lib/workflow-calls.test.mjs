import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callsIn, contractProblems, interfaceOf, pinsIn, SHARED } from './workflow-calls.mjs';

const SHA = 'aa12aaa99407e2800ffccb4db21ff962dc681b05';

/** A GitHub Actions expression, the way a parsed workflow carries it. */
const expr = (inner) => `\${{ ${inner} }}`;

const CALLER = `name: CD / Example
on: push
jobs:
  notes:
    uses: ${SHARED}/.github/workflows/pr-release-notes.yml@${SHA} # v0.13.0
    with:
      pr-number: \${{ needs.a.outputs.pr }}
      dry-run: true
    secrets:
      OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
  all:
    uses: ${SHARED}/.github/workflows/check-code.yml@v0
    secrets: inherit
  local:
    uses: ./.github/workflows/other.yml
  inline:
    runs-on: ubuntu-latest
    steps:
      - run: 'echo "uses: ${SHARED}/.github/workflows/not-a-call.yml@v0"'
`;

const CALLEE = `on:
  workflow_call:
    inputs:
      pr-number:
        type: string
        required: true
      dry-run:
        type: boolean
        default: false
      retries:
        type: number
        default: 1
      mode:
        type: choice-like-unknown
    secrets:
      OPENAI_API_KEY:
        required: false
      DEPLOY_TOKEN:
        required: true
`;

test('pinsIn reads the workflow, the ref and the version comment of every call line', () => {
  assert.deepEqual(pinsIn(CALLER), [
    { line: 5, workflow: 'pr-release-notes.yml', ref: SHA, comment: 'v0.13.0' },
    { line: 12, workflow: 'check-code.yml', ref: 'v0', comment: '' },
  ]);
  assert.deepEqual(pinsIn('name: nothing\n'), []);
});

test('callsIn returns the shared calls with their inputs and secrets, and nothing else', () => {
  assert.deepEqual(callsIn(CALLER), [
    {
      job: 'notes',
      workflow: 'pr-release-notes.yml',
      ref: SHA,
      with: { 'pr-number': expr('needs.a.outputs.pr'), 'dry-run': true },
      secrets: { OPENAI_API_KEY: expr('secrets.OPENAI_API_KEY') },
      inheritsSecrets: false,
    },
    {
      job: 'all',
      workflow: 'check-code.yml',
      ref: 'v0',
      with: {},
      secrets: {},
      inheritsSecrets: true,
    },
  ]);
});

test('callsIn copes with a file that has no jobs, or a job that is not a map', () => {
  assert.deepEqual(callsIn('name: empty\n'), []);
  assert.deepEqual(callsIn(''), []);
  assert.deepEqual(callsIn('jobs:\n  odd: 3\n'), []);
  assert.deepEqual(callsIn('jobs:\n  empty:\n'), []);
});

test('a call that passes neither inputs nor secrets reads as empty maps', () => {
  assert.deepEqual(
    callsIn(`jobs:\n  bare:\n    uses: ${SHARED}/.github/workflows/check-unit.yml@v0\n`),
    [
      {
        job: 'bare',
        workflow: 'check-unit.yml',
        ref: 'v0',
        with: {},
        secrets: {},
        inheritsSecrets: false,
      },
    ],
  );
});

test('interfaceOf reads the declared inputs and secrets', () => {
  const face = interfaceOf(CALLEE);
  assert.deepEqual(Object.keys(face.inputs), ['pr-number', 'dry-run', 'retries', 'mode']);
  assert.deepEqual(Object.keys(face.secrets), ['OPENAI_API_KEY', 'DEPLOY_TOKEN']);
});

test('interfaceOf: an empty workflow_call declares nothing, and a plain workflow is not callable', () => {
  assert.deepEqual(interfaceOf('on:\n  workflow_call:\n'), { inputs: {}, secrets: {} });
  assert.equal(interfaceOf('on:\n  push:\n'), null);
  assert.equal(interfaceOf(''), null);
  assert.equal(interfaceOf('name: no triggers\n'), null);
});

const call = (overrides) => ({
  job: 'notes',
  workflow: 'pr-release-notes.yml',
  ref: SHA,
  with: { 'pr-number': '1' },
  secrets: { DEPLOY_TOKEN: expr('secrets.DEPLOY_TOKEN') },
  inheritsSecrets: false,
  ...overrides,
});

test('a call that fits the interface has no problems', () => {
  const face = interfaceOf(CALLEE);
  assert.deepEqual(contractProblems(call({}), face), []);
  assert.deepEqual(
    contractProblems(
      call({ with: { 'pr-number': expr('x'), 'dry-run': expr('y'), retries: 3, mode: 'x' } }),
      face,
    ),
    [],
  );
  assert.deepEqual(contractProblems(call({ secrets: {}, inheritsSecrets: true }), face), []);
});

test('every way a call can miss the interface is named', () => {
  const face = interfaceOf(CALLEE);
  assert.deepEqual(
    contractProblems(
      call({
        with: { 'dry-run': 'true', retries: '2', 'pr-number': 7, typo: 1 },
        secrets: { OPENAI_KEY: 'x' },
      }),
      face,
    ),
    [
      'notes -> pr-release-notes.yml: input dry-run is a boolean, got "true" (string)',
      'notes -> pr-release-notes.yml: input retries is a number, got "2" (string)',
      'notes -> pr-release-notes.yml: input pr-number is a string, got 7 (number)',
      'notes -> pr-release-notes.yml: input typo is not declared by the called workflow',
      'notes -> pr-release-notes.yml: secret OPENAI_KEY is not declared by the called workflow',
      'notes -> pr-release-notes.yml: required secret DEPLOY_TOKEN is not passed',
    ],
  );
  assert.deepEqual(contractProblems(call({ with: {} }), face), [
    'notes -> pr-release-notes.yml: required input pr-number is not passed',
  ]);
});

test('a callee without workflow_call is one problem, not a crash', () => {
  assert.deepEqual(contractProblems(call({}), null), [
    'notes -> pr-release-notes.yml: the called workflow has no on.workflow_call',
  ]);
});

test('a callee whose declarations are empty maps still checks every call', () => {
  const face = interfaceOf(
    'on:\n  workflow_call:\n    inputs:\n      a:\n    secrets:\n      b:\n',
  );
  assert.deepEqual(contractProblems(call({ with: { a: 1 }, secrets: { b: 'x' } }), face), []);
});
