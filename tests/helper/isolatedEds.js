// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// Test support, not a test: a private EDS on a private D-Bus with a synthetic
// fixture calendar (*.test domains only). The environment is built from
// scratch so that nothing can reach the owner's real session bus.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { parseHelperLine } from '../../extension/core/protocol.js';

export const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const TOKYO_OFFSET_MS = 9 * HOUR_MS;
const RUN_TIMEOUT_MS = 30_000;

const repoRoot = path.resolve(import.meta.dirname, '../..');
/** Absolute path of the helper's entry file. */
export const HELPER_MAIN = path.join(repoRoot, 'extension/helper/main.js');
const ADD_EVENT = path.join(import.meta.dirname, 'gjs/addEvent.js');

/** The next whole UTC hour at or after nowMs. */
export function nextWholeHour(nowMs) {
    return Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
}

/** UTC basic format YYYYMMDDTHHMMSSZ. */
export function u(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Asia/Tokyo wall time in basic format, without a Z. */
function t(ms) {
    return u(ms + TOKYO_OFFSET_MS).slice(0, -1);
}

/** America/New_York wall time of ms in basic format, without a Z (follows DST). */
function newYork(ms) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(ms).map(p => [p.type, p.value]));
    return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

/** 'YYYYMMDD' of the Asia/Tokyo wall date of ms. */
export function tokyoDate(ms) {
    return u(ms + TOKYO_OFFSET_MS).slice(0, 8);
}

function nextDate(yyyymmdd) {
    const ms = Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) + 24 * HOUR_MS;
    return u(ms).slice(0, 8);
}

/** The fixture calendar.ics text, times relative to baseMs, CRLF line ends. */
export function fixtureIcs(baseMs) {
    const H = baseMs, h = HOUR_MS;
    const D = tokyoDate(H + 24 * h);
    const D1 = nextDate(D);
    const events = [
        [
            'UID:tz-convert@fixture.test', `DTSTART;TZID=Asia/Tokyo:${t(H + h)}`, `DTEND;TZID=Asia/Tokyo:${t(H + 2 * h)}`,
            'SUMMARY:Tokyo sync', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
            'ORGANIZER;CN=Alice Organiser:mailto:Alice@External.test',
            'ATTENDEE;CN=Owner;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:owner@fixture.test',
            'ATTENDEE;CN=Bob;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:MAILTO:Bob@External.test',
            'ATTENDEE;CN=Board Room 4;CUTYPE=ROOM;PARTSTAT=ACCEPTED;ROLE=NON-PARTICIPANT:mailto:room4@rooms.fixture.test',
            'ATTENDEE;CN=Projector;CUTYPE=RESOURCE;PARTSTAT=NEEDS-ACTION:mailto:projector@rooms.fixture.test',
            'ATTENDEE;CN=Team;CUTYPE=GROUP;PARTSTAT=DECLINED;ROLE=CHAIR:mailto:team@fixture.test',
            'ATTENDEE;CUTYPE=X-BOT;PARTSTAT=DELEGATED;ROLE=X-OBSERVER:mailto:bot@fixture.test',
            'ATTENDEE;PARTSTAT=X-MAYBE:mailto:carol@external.test',
            'ATTENDEE;CN=Erin;EMAIL=Erin@External.test:urn:uuid:erin-1',
            'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
        ],
        [
            'UID:zoom-description@fixture.test', `DTSTART:${u(H + 2 * h)}`, `DTEND:${u(H + 3 * h)}`,
            'SUMMARY:Zoom in description', 'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT',
            'DESCRIPTION:Join: https://zoom.us/j/123456789\\nPasscode 42',
        ],
        [
            'UID:conference-and-url@fixture.test', `DTSTART:${u(H + 4 * h)}`, `DTEND:${u(H + 5 * h)}`,
            'SUMMARY:Teams via CONFERENCE',
            'CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join:https://teams.microsoft.com/l/meetup-join/abc',
            'URL:https://example.test/agenda',
        ],
        [
            'UID:location-only@fixture.test', `DTSTART:${u(H + 5 * h)}`, `DTEND:${u(H + 6 * h)}`,
            'SUMMARY:Coffee at the office', 'LOCATION:12 Rue de Rivoli\\, Paris',
        ],
        [
            'UID:all-day@fixture.test', `DTSTART;VALUE=DATE:${D}`, `DTEND;VALUE=DATE:${D1}`,
            'SUMMARY:Holiday', 'TRANSP:TRANSPARENT',
        ],
        [
            'UID:cancelled@fixture.test', `DTSTART:${u(H + 6 * h)}`, `DTEND:${u(H + 7 * h)}`,
            'SUMMARY:Cancelled call', 'STATUS:CANCELLED', 'ORGANIZER:mailto:dave@external.test',
            'ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@fixture.test',
        ],
        [
            'UID:series@fixture.test', `DTSTART:${u(H + 3 * h)}`, `DTEND:${u(H + 3 * h + 30 * MINUTE_MS)}`,
            'SUMMARY:Standup', 'RRULE:FREQ=HOURLY;INTERVAL=6;COUNT=4', `EXDATE:${u(H + 21 * h)}`,
        ],
        [
            'UID:series@fixture.test', `RECURRENCE-ID:${u(H + 9 * h)}`,
            `DTSTART:${u(H + 10 * h)}`, `DTEND:${u(H + 10 * h + 30 * MINUTE_MS)}`,
            'SUMMARY:Standup (moved)', 'SEQUENCE:1',
        ],
        [
            'UID:series@fixture.test', `RECURRENCE-ID:${u(H + 15 * h)}`,
            `DTSTART:${u(H + 15 * h)}`, `DTEND:${u(H + 15 * h + 30 * MINUTE_MS)}`,
            'SUMMARY:Standup', 'STATUS:CANCELLED', 'SEQUENCE:1',
        ],
        [
            'UID:long-description@fixture.test', `DTSTART:${u(H + 7 * h)}`, `DTEND:${u(H + 8 * h)}`,
            'SUMMARY:Long', `DESCRIPTION:${'x'.repeat(32767)}\u{1F600}yyyy`,
        ],
        // Not the test's zone (Asia/Tokyo), so a TZID that is ignored shows.
        [
            'UID:tz-new-york@fixture.test', `DTSTART;TZID=America/New_York:${newYork(H + 11 * h)}`,
            `DTEND;TZID=America/New_York:${newYork(H + 12 * h)}`, 'SUMMARY:New York sync',
        ],
        // Floating: wall time in the local zone (the test's TZ, Asia/Tokyo).
        [
            'UID:floating@fixture.test', `DTSTART:${t(H + 13 * h)}`, `DTEND:${t(H + 14 * h)}`, 'SUMMARY:Floating',
        ],
        [
            'UID:too-late@fixture.test', `DTSTART:${u(H + 48 * h)}`, `DTEND:${u(H + 49 * h)}`, 'SUMMARY:Out of range',
        ],
        [
            'UID:too-early@fixture.test', `DTSTART:${u(H - 5 * h)}`, `DTEND:${u(H - 3 * h)}`, 'SUMMARY:Out of range',
        ],
    ];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//payAttention//fixture//EN'];
    for (const ev of events)
        lines.push('BEGIN:VEVENT', ...ev, 'DTSTAMP:20260101T000000Z', 'END:VEVENT');
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
}

function sourceFile({ name, backend, selected, email }) {
    const lines = [
        '[Data Source]', `DisplayName=${name}`, 'Enabled=true', 'Parent=local-stub', '',
        '[Calendar]', `BackendName=${backend}`, `Selected=${selected}`,
    ];
    if (email)
        lines.push('', '[Local Backend]', `EmailAddress=${email}`);
    return lines.join('\n') + '\n';
}

// Port 9 on loopback: nothing listens, so no request ever leaves the machine.
const REMOTE_SOURCE = [
    '[Data Source]', 'DisplayName=Remote', 'Enabled=true', 'Parent=', '',
    '[Calendar]', 'BackendName=caldav', 'Selected=true', '',
    '[Authentication]', 'Host=127.0.0.1', 'Port=9', 'User=', 'Method=none', '',
    '[Security]', 'Method=none', '',
    '[WebDAV Backend]', 'ResourcePath=/cal/', '',
    '[Offline]', 'StaySynchronized=false', '',
].join('\n');

/**
 * A private EDS with the fixture calendar, on its own dbus-daemon.
 *
 * @param {string} name a short label; the home is <repo>/.test-home/helper-<name>
 * @param {number} baseMs H, the whole hour the fixture times are relative to
 * @param {{withRemote?: boolean}} [options] withRemote adds 'remote-cal', a
 *   CalDAV source on a closed loopback port (remote, never reachable)
 * @returns {Promise<{home:string, env:object, stop:() => Promise<void>}>}
 */
export async function createIsolatedEds(name, baseMs, { withRemote = false } = {}) {
    const home = path.join(repoRoot, '.test-home', `helper-${name}`);
    // Cleaned at start, not at the end, so there is no race with EDS still writing.
    fs.rmSync(home, { recursive: true, force: true });
    const sources = path.join(home, 'config/evolution/sources');
    const calendar = path.join(home, 'data/evolution/calendar/fixture-cal');
    fs.mkdirSync(sources, { recursive: true });
    fs.mkdirSync(calendar, { recursive: true });
    fs.mkdirSync(path.join(home, 'cache'), { recursive: true });

    fs.writeFileSync(path.join(sources, 'fixture-cal.source'),
        sourceFile({ name: 'Fixture', backend: 'local', selected: true, email: 'Owner@Fixture.test' }));
    fs.writeFileSync(path.join(sources, 'broken-cal.source'),
        sourceFile({ name: 'Broken', backend: 'no-such-backend', selected: true }));
    fs.writeFileSync(path.join(sources, 'hidden-cal.source'),
        sourceFile({ name: 'Hidden', backend: 'local', selected: false }));
    fs.writeFileSync(path.join(calendar, 'calendar.ics'), fixtureIcs(baseMs));
    if (withRemote)
        fs.writeFileSync(path.join(sources, 'remote-cal.source'), REMOTE_SOURCE);

    // Never spread process.env: it carries the real DBUS_SESSION_BUS_ADDRESS.
    const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: 'C.UTF-8',
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        GSETTINGS_BACKEND: 'memory',
        GIO_USE_VFS: 'local',
        TZ: 'Asia/Tokyo',
    };

    const bus = await startPrivateBus(env);
    return { home, env, stop: bus.stop };
}

/**
 * Starts `dbus-daemon --session --nofork --print-address=1` with env (never the real bus),
 * sets env.DBUS_SESSION_BUS_ADDRESS, and returns a stop() that SIGTERMs it and awaits its exit.
 *
 * @param {object} env built from scratch by the caller; mutated (bus address added)
 * @returns {Promise<{stop: () => Promise<void>}>}
 */
export async function startPrivateBus(env) {
    const daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'],
        { env, stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise(resolve => daemon.once('exit', resolve));
    const address = await new Promise((resolve, reject) => {
        const lines = readline.createInterface({ input: daemon.stdout });
        lines.once('line', line => resolve(line.trim()));
        daemon.once('error', reject);
        daemon.once('exit', code => reject(new Error(`dbus-daemon exited with ${code} before printing its address`)));
    });
    env.DBUS_SESSION_BUS_ADDRESS = address;

    async function stop() {
        daemon.kill('SIGTERM');
        await exited;
    }
    return { stop };
}

/**
 * Run the helper to completion.
 *
 * @returns {Promise<{code:number|null, signal:string|null, stdout:string, stderr:string}>}
 *   rejects (after SIGKILL) if it runs longer than 30 s
 */
export function runHelper(env, args) {
    return new Promise((resolve, reject) => {
        const child = spawn('gjs', ['-m', HELPER_MAIN, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.setEncoding('utf8').on('data', d => (stdout += d));
        child.stderr.setEncoding('utf8').on('data', d => (stderr += d));
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`helper ${args.join(' ')} did not exit within ${RUN_TIMEOUT_MS} ms`));
        }, RUN_TIMEOUT_MS);
        child.once('error', e => {
            clearTimeout(timer);
            reject(e);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, stdout, stderr });
        });
        child.stdin.end();
    });
}

/**
 * SIGKILLs the evolution-calendar-factory of THIS isolated EDS only: the
 * process is picked by its environment carrying this test's private bus
 * address, so the owner's real EDS can never match.
 *
 * @returns {number} how many processes were killed
 */
export function killIsolatedCalendarFactory(env) {
    return killOnPrivateBus(env, 'evolution-calendar-factory');
}

/**
 * SIGKILLs every process whose argv[0] basename is programName AND whose
 * environment carries env's private DBUS_SESSION_BUS_ADDRESS. Never matches by name alone.
 *
 * @returns {number} how many were killed
 */
export function killOnPrivateBus(env, programName) {
    const busEntry = `DBUS_SESSION_BUS_ADDRESS=${env.DBUS_SESSION_BUS_ADDRESS}`;
    let killed = 0;
    for (const pid of fs.readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
        let environ, argv0;
        try {
            environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
            argv0 = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0];
        } catch {
            continue; // gone, or not ours to read
        }
        if (path.basename(argv0) === programName && environ.includes(busEntry)) {
            process.kill(Number(pid), 'SIGKILL');
            killed++;
        }
    }
    return killed;
}

/** A helper running in serve mode. */
class HelperProcess {
    constructor(env) {
        this._child = spawn('gjs', ['-m', HELPER_MAIN], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        this._lines = [];
        this._waiters = [];
        this._stderr = '';
        this._exit = new Promise(resolve => this._child.once('exit', (code, signal) => resolve({ code, signal })));
        this._child.stderr.setEncoding('utf8').on('data', d => (this._stderr += d));
        readline.createInterface({ input: this._child.stdout }).on('line', line => {
            const waiter = this._waiters.shift();
            if (waiter)
                waiter(line);
            else
                this._lines.push(line);
        });
    }

    /**
     * The next stdout line, proven to be a valid protocol message.
     *
     * @returns {Promise<{line:string, parsed:object}>} rejects on timeout
     */
    nextMessage(timeoutMs) {
        const check = line => {
            const parsed = parseHelperLine(line);
            assert.equal(parsed.ok, true, `invalid helper line: ${JSON.stringify(parsed)}`);
            return { line, parsed };
        };
        if (this._lines.length > 0)
            return Promise.resolve(check(this._lines.shift()));
        return new Promise((resolve, reject) => {
            const waiter = line => {
                clearTimeout(timer);
                try {
                    resolve(check(line));
                } catch (e) {
                    reject(e);
                }
            };
            const timer = setTimeout(() => {
                this._waiters.splice(this._waiters.indexOf(waiter), 1);
                reject(new Error(`no helper message within ${timeoutMs} ms`));
            }, timeoutMs);
            this._waiters.push(waiter);
        });
    }

    send(text) {
        this._child.stdin.write(text);
    }

    closeStdin() {
        this._child.stdin.end();
    }

    /** @returns {Promise<{code:number|null, signal:string|null}>} rejects on timeout */
    exited(timeoutMs) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`helper did not exit within ${timeoutMs} ms`)), timeoutMs);
        });
        return Promise.race([this._exit, timeout]).finally(() => clearTimeout(timer));
    }

    stderr() {
        return this._stderr;
    }

    /** For after-hooks: make sure a failed test leaves no process behind. */
    kill() {
        this._child.kill('SIGKILL');
    }
}

/** Start the helper in serve mode. */
export function startHelper(env) {
    return new HelperProcess(env);
}

/**
 * Add one VEVENT to the fixture calendar through EDS (test-only writer).
 *
 * @returns {Promise<void>} rejects on a non-zero exit
 */
export function addFixtureEvent(env, veventText) {
    return new Promise((resolve, reject) => {
        const child = spawn('gjs', ['-m', ADD_EVENT, veventText], { env, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.setEncoding('utf8').on('data', d => (stderr += d));
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`addEvent exited with ${code ?? signal}: ${stderr}`));
        });
    });
}
