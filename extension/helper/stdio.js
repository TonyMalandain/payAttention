// The process's three file descriptors. stdout carries protocol lines only
// (and the counts-only summary); stderr carries short diagnostic codes only.
// Calendar content never reaches stderr.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import { formatHelperMessage } from '../core/protocol.js';

const DIAGNOSTIC_CODE = /^[a-z0-9][a-z0-9._-]*$/;
const DIAGNOSTIC_DETAIL = /^[A-Za-z0-9 ._:[\]-]*$/;

const encoder = new TextEncoder();

function writeAll(stream, text) {
    stream.write_all(encoder.encode(text), null);
    stream.flush(null);
}

/** Protocol output on fd 1. */
export class Stdout {
    constructor() {
        this._stream = GioUnix.OutputStream.new(1, false);
    }

    /**
     * Write one protocol message as one line. Goes through core's
     * formatHelperMessage, so a non-protocol line can never reach stdout.
     *
     * @param {object} message
     * @throws {TypeError} when the message is not valid protocol v1
     */
    send(message) {
        writeAll(this._stream, formatHelperMessage(message));
    }

    /**
     * Write plain text. For --summary only.
     *
     * @param {string} text
     */
    writeText(text) {
        writeAll(this._stream, text);
    }
}

let stderrStream = null;

/**
 * Writes `payattention-helper: <code>[ <detail>]\n` to fd 2. A code or detail
 * outside the allowed characters is replaced with "(redacted)", so no free
 * text (which could carry calendar content) reaches the log.
 *
 * @param {string} code
 * @param {string} [detail]
 */
export function reportDiagnostic(code, detail = '') {
    const safeCode = DIAGNOSTIC_CODE.test(code) ? code : '(redacted)';
    const safeDetail = DIAGNOSTIC_DETAIL.test(detail) ? detail : '(redacted)';
    stderrStream ??= GioUnix.OutputStream.new(2, false);
    writeAll(stderrStream, `payattention-helper: ${safeCode}${safeDetail ? ' ' + safeDetail : ''}\n`);
}

/**
 * Reads fd 0 line by line. Calls onLine(string) per line, onEof() once at EOF
 * or on a read error. A line that is not valid UTF-8 is passed on as '\uFFFD',
 * which the caller reports as a bad command.
 *
 * @param {{onLine: (line:string) => void, onEof: () => void}} handlers
 */
export function watchStdin({ onLine, onEof }) {
    const input = new Gio.DataInputStream({
        base_stream: GioUnix.InputStream.new(0, false),
        close_base_stream: false,
    });
    const readNext = () => {
        input.read_line_async(GLib.PRIORITY_DEFAULT, null, (_o, res) => {
            let line;
            try {
                [line] = input.read_line_finish_utf8(res);
            } catch (e) {
                if (e instanceof GLib.Error &&
                    (e.matches(GLib.ConvertError, e.code) || e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.INVALID_DATA))) {
                    onLine('\uFFFD');
                    readNext();
                } else {
                    onEof();
                }
                return;
            }
            if (line === null) {
                onEof();
                return;
            }
            onLine(line);
            readNext();
        });
    };
    readNext();
}
