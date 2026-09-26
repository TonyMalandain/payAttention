import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    BUILTIN_IGNORE_WORDS, BUILTIN_IMPORTANT_WORDS, NOT_A_PLACE_WORDS, compileWords, findWord,
} from '../../extension/core/words.js';

describe('ignore words', () => {
    const m = compileWords(BUILTIN_IGNORE_WORDS, []);

    test('a word matches regardless of case', () => {
        assert.equal(findWord(m, 'LUNCH with Bob'), 'lunch');
    });

    test('only whole words match', () => {
        assert.equal(findWord(m, 'Lunchtime chat'), null);
        assert.equal(findWord(m, 'Stakeholder sync'), null);
    });

    test('whitespace runs are allowed and the longest phrase wins', () => {
        assert.equal(findWord(m, 'Focus   Time'), 'focus time');
        assert.equal(findWord(m, 'Tentative hold: Q3'), 'tentative hold');
    });

    test('short words and inflected list words match', () => {
        assert.equal(findWord(m, 'OOO - Alice'), 'ooo');
        assert.equal(findWord(m, 'Blocked: design'), 'blocked');
    });

    test('word boundaries respect letters beyond ASCII', () => {
        assert.equal(findWord(m, 'Déjeuner lunch'), 'lunch');
        assert.equal(findWord(m, 'lunché'), null);
    });
});

describe('important words', () => {
    const i = compileWords(BUILTIN_IMPORTANT_WORDS, []);

    test('1:1 matches as a word but not inside a time', () => {
        assert.equal(findWord(i, 'Alice / Bob 1:1'), '1:1');
        assert.equal(findWord(i, '11:15 standup'), null);
    });

    test('1-1 matches', () => {
        assert.equal(findWord(i, '1-1 Dana'), '1-1');
    });

    test('"review with" matches as a phrase, "review" alone does not', () => {
        assert.equal(findWord(i, 'Review with Dana'), 'review with');
        assert.equal(findWord(i, 'Code review'), null);
    });

    test('a list word inside a longer word does not match', () => {
        assert.equal(findWord(i, 'Boardwalk'), null);
    });
});

describe('extra words', () => {
    const e = compileWords([], ['  Stand-Up ', '', 'c++ review', 'STAND-UP']);

    test('extra words are normalised', () => {
        assert.equal(findWord(e, 'Daily stand-up'), 'stand-up');
    });

    test('regex special characters are matched literally', () => {
        assert.equal(findWord(e, 'C++ Review'), 'c++ review');
    });

    test('duplicates and empty words are dropped', () => {
        assert.equal(findWord(e, 'nothing here'), null);
        assert.equal(findWord(e, ''), null);
    });
});

describe('matcher and lists', () => {
    test('only a compiled matcher is accepted', () => {
        assert.throws(() => findWord({}, 'x'), TypeError);
    });

    test('the built-in lists are the PRD lists, in PRD order', () => {
        assert.deepEqual(BUILTIN_IGNORE_WORDS, ['hold', 'placeholder', 'block', 'blocked', 'focus', 'focus time',
            'deep work', 'lunch', 'break', 'commute', 'travel', 'ooo', 'out of office', 'busy', 'tentative hold',
            'do not book', 'dnb', 'reminder', 'gym']);
        assert.deepEqual(BUILTIN_IMPORTANT_WORDS, ['interview', 'client', 'customer', 'board', 'investor',
            'candidate', 'exec', 'review with', 'demo', 'pitch', 'contract', 'legal', 'offsite', '1:1', '1-1',
            'one on one']);
    });

    test('the not-a-place words are the PRD §2 list, lowercased', () => {
        assert.deepEqual(NOT_A_PLACE_WORDS, ['online', 'virtual', 'remote', 'tbd', 'phone', 'call', 'video call',
            'zoom', 'zoom meeting', 'teams', 'microsoft teams', 'google meet', 'meet', 'webex', 'hangout', 'slack']);
    });

    test('the lists are frozen', () => {
        assert.ok(Object.isFrozen(BUILTIN_IGNORE_WORDS));
        assert.ok(Object.isFrozen(BUILTIN_IMPORTANT_WORDS));
        assert.ok(Object.isFrozen(NOT_A_PLACE_WORDS));
    });
});
