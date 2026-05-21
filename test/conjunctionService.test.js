const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeConjunctionsFromRecords } = require('../backend/src/services/conjunctionService');

test('analyzeConjunctionsFromRecords handles empty records gracefully', async () => {
    const result = await analyzeConjunctionsFromRecords([], null, new Date().toISOString(), 60, 5, {});
    assert.equal(result.analysisType, 'conjunction_analysis');
    assert.equal(Array.isArray(result.conjunctions), true);
    assert.equal(result.conjunctions.length, 0);
});

