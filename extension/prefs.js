// The settings window (PRD §6): edits the owner's settings keys only, never
// alert-state or the health-* keys.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { parseList, normalizeDomains, normalizeAddresses } from './core/display.js';
import { BUILTIN_IMPORTANT_WORDS, BUILTIN_IGNORE_WORDS } from './core/words.js';

function group(title, description) {
    return new Adw.PreferencesGroup({ title, description: description ?? '' });
}

/** An integer setting, limited to the schema's range. */
function spinRow(settings, key, title, step = 1) {
    const [lower, upper] = settings.settings_schema.get_key(key).get_range().recursiveUnpack()[1];
    const row = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({ lower, upper, step_increment: step, page_increment: step * 10 }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** A comma list, normalized when applied and shown back as stored. */
function listRow(settings, key, title, normalize) {
    const row = new Adw.EntryRow({ title, show_apply_button: true, text: settings.get_strv(key).join(', ') });
    row.connect('apply', () => {
        const normalized = normalize(parseList(row.text));
        settings.set_strv(key, normalized);
        row.text = normalized.join(', ');
    });
    return row;
}

function buttonRow(title, onActivated) {
    const row = new Adw.ButtonRow({ title });
    row.connect('activated', onActivated);
    return row;
}

const asIs = items => items;

export default class PayAttentionPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Kept alive with the window.
        window._settings = settings;

        const alerts = new Adw.PreferencesPage({ title: 'Alerts', icon_name: 'alarm-symbolic' });

        const online = group('Online meetings', 'Minutes before the start');
        online.add(spinRow(settings, 'online-headsup-minutes', 'Heads-up'));
        online.add(spinRow(settings, 'online-nudge-minutes', 'Nudge'));
        online.add(spinRow(settings, 'online-insist-minutes', 'Insist'));
        online.add(spinRow(settings, 'online-takeover-minutes', 'Takeover'));
        alerts.add(online);

        const inPerson = group('In-person meetings', 'Minutes before you must leave');
        inPerson.add(spinRow(settings, 'inperson-headsup-minutes', 'Heads-up'));
        inPerson.add(spinRow(settings, 'inperson-nudge-minutes', 'Nudge'));
        inPerson.add(spinRow(settings, 'inperson-insist-minutes', 'Insist'));
        inPerson.add(spinRow(settings, 'inperson-takeover-minutes', 'Takeover'));
        inPerson.add(spinRow(settings, 'default-travel-minutes', 'Default travel time (minutes)', 5));
        alerts.add(inPerson);

        const behaviour = group('Behaviour');
        behaviour.add(spinRow(settings, 'headsup-display-seconds', 'Heads-up stays for (seconds)'));
        behaviour.add(spinRow(settings, 'snooze-minutes', 'Snooze (minutes)'));
        behaviour.add(spinRow(settings, 'takeover-snooze-minutes', 'Snooze during takeover (minutes)'));
        behaviour.add(spinRow(settings, 'cutoff-minutes', 'Stop alerting after the start (minutes)'));
        const sound = new Adw.SwitchRow({ title: 'Sound at insist and takeover' });
        settings.bind('sound-enabled', sound, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(sound);
        alerts.add(behaviour);

        const judgment = new Adw.PreferencesPage({ title: 'Judgment', icon_name: 'emblem-important-symbolic' });

        const meetings = group('Meetings');
        meetings.add(spinRow(settings, 'large-meeting-size', 'Large meeting: more than this many guests'));
        judgment.add(meetings);

        // Adw.EntryRow has no subtitle, so the built-in lists go in the group description.
        const words = group('Words',
            `Built in, important: ${BUILTIN_IMPORTANT_WORDS.join(', ')}\nBuilt in, ignore: ${BUILTIN_IGNORE_WORDS.join(', ')}`);
        words.add(listRow(settings, 'extra-important-words', 'Extra important words', asIs));
        words.add(listRow(settings, 'extra-ignore-words', 'Extra ignore words', asIs));
        judgment.add(words);

        const you = group('You');
        you.add(listRow(settings, 'owner-domains', 'Your email domains (empty = detect from your calendars)', normalizeDomains));
        you.add(listRow(settings, 'extra-owner-addresses', 'Extra addresses of yours', normalizeAddresses));
        judgment.add(you);

        const saved = group('Saved choices');
        saved.add(buttonRow('Clear meeting overrides', () => {
            settings.reset('verdict-overrides');
            settings.reset('mode-overrides');
        }));
        saved.add(buttonRow('Clear travel times', () => settings.reset('travel-times')));
        judgment.add(saved);

        window.add(alerts);
        window.add(judgment);
    }
}
