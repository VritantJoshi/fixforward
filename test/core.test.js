import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFailures } from '../src/parse.js';
import { diagnose } from '../src/rules.js';
import { addToManifest, readMembers } from '../src/manifest.js';

const sfFailure = (details) => ({ status: 1, result: { success: false, status: 'Failed', details } });

test('missing field is detected from an Apex compile error', () => {
  const f = extractFailures(sfFailure({ componentFailures: {
    componentType: 'ApexClass', fullName: 'AccountScorer', fileName: 'classes/AccountScorer.cls',
    problem: 'Field does not exist: Priority_Score__c on Account' } }));
  const [d] = diagnose(f);
  assert.equal(d.rule, 'MISSING_FIELD');
  assert.deepEqual(d.details, { field: 'Priority_Score__c', object: 'Account' });
  assert.equal(d.fixable, true);
});

test('coverage warning and test failure are classified', () => {
  const dx = diagnose(extractFailures(sfFailure({ runTestResult: {
    codeCoverageWarnings: [{ name: { $: { 'xsi:nil': 'true' } }, message: 'Average test coverage across all Apex Classes and Triggers is 22%, at least 75% test coverage is required.' }],
    failures: [{ name: 'FooTest', methodName: 'testIt', message: 'System.AssertException: Assertion Failed' }] } })));
  assert.deepEqual(dx.map((d) => d.rule).sort(), ['LOW_COVERAGE', 'TEST_FAILURE']);
  assert.equal(dx.find((d) => d.rule === 'LOW_COVERAGE').details.percent, 22);
  assert.equal(dx.find((d) => d.rule === 'LOW_COVERAGE').details.className, null); // org-wide, not a class called "es"
});

test('unknown errors fall through to UNKNOWN and plain-text logs are parsed', () => {
  const dx = diagnose(extractFailures('step 3\nERROR: Something odd happened in the org\nok'));
  assert.equal(dx[0].rule, 'UNKNOWN');
});

test('manifest editing adds members once', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-')), 'package.xml');
  fs.writeFileSync(p, '<?xml version="1.0"?>\n<Package>\n    <types>\n        <members>A</members>\n        <name>ApexClass</name>\n    </types>\n    <version>61.0</version>\n</Package>\n');
  assert.equal(addToManifest(p, 'CustomField', 'Account.X__c'), true);
  assert.equal(addToManifest(p, 'CustomField', 'Account.X__c'), false);
  assert.equal(addToManifest(p, 'ApexClass', 'B'), true);
  assert.deepEqual(readMembers(p, 'ApexClass'), ['A', 'B']);
  assert.deepEqual(readMembers(p, 'CustomField'), ['Account.X__c']);
});

test('plain-text sf output: per-trigger coverage, org average and failing test are all recognised', () => {
  const text = [
    'Error (FailedValidationError): Failed to validate the deployment. Due To:',
    'EmployeeTrigger - Test coverage of selected Apex Trigger is 0%, at least 1% test coverage is required',
    'CaseTrigger - Test coverage of selected Apex Trigger is 0%, at least 1% test coverage is required',
    'Average test coverage across all Apex Classes and Triggers is 10%, at least 75% test coverage is required.',
    'AccountTriggerHandlerTest.checkClone - System.LimitException: Too many DML rows: 10001',
  ].join('\n');
  const dx = diagnose(extractFailures(text));
  const cov = dx.filter((d) => d.rule === 'LOW_COVERAGE');
  assert.deepEqual(cov.map((d) => d.details.className), ['EmployeeTrigger', 'CaseTrigger', null]);
  assert.equal(cov[2].details.percent, 10);
  assert.ok(dx.some((d) => d.rule === 'TEST_FAILURE' && d.details.test === 'AccountTriggerHandlerTest.checkClone'));
});

test('combined "Due To:" message is split into separate test failures', () => {
  const msg = 'Failed to validate the deployment (0Afg700000Hx7GbCAJ). Due To: DiscountCalculatorTest.testNegativeAmount - System.AssertException: Assertion Failed: Expected: 0, Actual: -100.00,DiscountCalculatorTest.testTierCase - System.AssertException: Assertion Failed: Expected: 0.00, Actual: 50.00';
  const dx = diagnose(extractFailures({ status: 1, name: 'FailedValidationError', message: msg }));
  assert.deepEqual(dx.map((d) => d.rule), ['TEST_FAILURE', 'TEST_FAILURE']);
  assert.deepEqual(dx.map((d) => d.details.testClass), ['DiscountCalculatorTest', 'DiscountCalculatorTest']);
});

test('summary lines like "3 component error(s)" are not reported as errors', () => {
  const dx = diagnose(extractFailures({ status: 1, message: '3 component error(s)', result: { success: false, details: { componentFailures: [
    { componentType: 'ApexClass', fullName: 'AccountScorer', problem: 'Variable does not exist: Priority_Score__c' },
    { componentType: '', fullName: '', problem: '3 component error(s)' } ] } } }));
  assert.deepEqual(dx.map((d) => d.rule), ['MISSING_FIELD']);
});
