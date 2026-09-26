import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, parseHttpsUrl, isConferenceUrl } from '../../extension/core/links.js';

describe('conferencing links', () => {
    const accepted = [
        'https://meet.google.com/abc-defg-hij',
        'https://zoom.us/j/123',
        'https://us02web.zoom.us/j/123?pwd=x',
        'https://zoomgov.com/j/1',
        'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
        'https://teams.live.com/meet/123',
        'https://acme.webex.com/meet/bob',
        'https://whereby.com/room',
        'https://meet.jit.si/Room',
        'https://8x8.vc/abc/room',
        'https://meet.goto.com/123456789',
        'https://global.gotomeeting.com/join/1',
        'https://gotomeet.me/bob',
        'https://app.slack.com/huddle/T1/C2',
        'HTTPS://MEET.GOOGLE.COM/abc',
        'https://meet.google.com./abc',
        'https://zoom.us:443/j/1',
    ];
    for (const url of accepted) {
        test(`${url} is a conferencing link`, () => {
            assert.equal(isConferenceUrl(url), true);
        });
    }

    const refused = [
        ['http://zoom.us/j/1', 'not https'],
        ['https://zoom.us.evil.test/j/1', 'lookalike suffix'],
        ['https://evilzoom.us/j/1', 'lookalike prefix'],
        ['https://notmeet.google.com/x', 'lookalike prefix'],
        ['https://meet.google.com@evil.test/x', 'user-info'],
        ['https://app.slack.com/client/T1/C2', 'not a huddle'],
        ['https://example.com/meet', 'not a conferencing service'],
        ['javascript:alert(1)', 'not a web link'],
        ['', 'empty'],
    ];
    for (const [url, why] of refused) {
        test(`${url || "''"} is not a conferencing link (${why})`, () => {
            assert.equal(isConferenceUrl(url), false);
        });
    }
});

describe('finding links in text', () => {
    test('trailing punctuation is not part of the link', () => {
        assert.deepEqual(extractUrls('Join: https://zoom.us/j/123.'), ['https://zoom.us/j/123']);
    });

    test('a link inside HTML is found', () => {
        assert.deepEqual(extractUrls('<a href="https://meet.google.com/abc-defg-hij">Join</a>'),
            ['https://meet.google.com/abc-defg-hij']);
    });

    test('HTML-escaped ampersands are unescaped', () => {
        assert.deepEqual(extractUrls('https://zoom.us/j/1?a=1&amp;b=2'), ['https://zoom.us/j/1?a=1&b=2']);
    });

    test('a link in parentheses is found without them', () => {
        assert.deepEqual(extractUrls('(https://whereby.com/x)'), ['https://whereby.com/x']);
    });

    test('text without a link gives none', () => {
        assert.deepEqual(extractUrls('no link'), []);
    });

    test('several links come back in text order', () => {
        assert.deepEqual(extractUrls('a https://b.test/1 c http://d.test/2'), ['https://b.test/1', 'http://d.test/2']);
    });
});

describe('parsing https links', () => {
    test('host is lowercased without port, path stops at query and fragment', () => {
        assert.deepEqual(parseHttpsUrl('https://Zoom.US:8443/j/1?x#y'), { host: 'zoom.us', path: '/j/1' });
    });

    test('a host with a space is refused', () => {
        assert.equal(parseHttpsUrl('https://a b/'), null);
    });

    test('an empty path is /', () => {
        assert.deepEqual(parseHttpsUrl('https://whereby.com'), { host: 'whereby.com', path: '/' });
    });
});
