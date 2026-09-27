// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

// The licensing checks (D-026, plan PG-6). Not a test file. Pure: values in, values
// out; licensing.test.js does the reading.

/** Licences a development dependency may have. Frozen. */
export const ALLOWED_LICENCES = Object.freeze(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'BlueOak-1.0.0']);

const PROJECT_LICENCE = 'Apache-2.0';
// Any of these would make npm install a package for a user of this package.
const SHIPPING_KEYS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'];

/**
 * @param {object} pkg  parsed package.json
 * @param {object} lock parsed package-lock.json (lockfileVersion 3)
 * @returns {string[]} one line per problem, e.g. 'node_modules/foo: licence GPL-3.0-only is not allowed'; [] when clean
 */
export function dependencyLicenceProblems(pkg, lock) {
    const problems = [];
    if (pkg.license !== PROJECT_LICENCE)
        problems.push(`package.json: licence ${JSON.stringify(pkg.license)} is not ${PROJECT_LICENCE}`);
    for (const key of SHIPPING_KEYS) {
        if (Object.hasOwn(pkg, key))
            problems.push(`package.json: has a "${key}" key; only devDependencies are allowed, nothing ships`);
    }
    const packages = lock.packages ?? {};
    const rootLicence = packages['']?.license;
    if (rootLicence !== pkg.license)
        problems.push(`package-lock.json: root licence ${JSON.stringify(rootLicence)} differs from package.json ${JSON.stringify(pkg.license)}`);
    for (const [name, entry] of Object.entries(packages)) {
        if (name === '')
            continue;
        const licence = entry.license;
        if (typeof licence !== 'string' || !ALLOWED_LICENCES.includes(licence))
            problems.push(`${name}: licence ${JSON.stringify(licence)} is not allowed; review it, then extend ALLOWED_LICENCES and THIRD-PARTY.md`);
        if (entry.dev !== true)
            problems.push(`${name}: not a dev-only dependency (dev is ${JSON.stringify(entry.dev)})`);
    }
    return problems;
}

const FIRST_YEAR = 2026;
const HOLDER = 'Tony Malandain';

// Per file type: how the two SPDX lines are wrapped, and the line that must stay
// above them (a shebang, or the XML declaration), if any.
const HEADER_FORMS = {
    '.js': { open: '// ', close: '', before: null },
    '.sh': { open: '# ', close: '', before: /^#!/ },
    '.css': { open: '/\\* ', close: ' \\*/', before: null },
    '.xml': { open: '<!-- ', close: ' -->', before: /^<\?xml\b.*\?>$/ },
};

/**
 * @param {string} relPath repo-relative path; its extension picks the comment syntax (.js .sh .css .xml)
 * @param {string} text    the file's content
 * @returns {string|null}  why the header is wrong, or null when it is right
 */
export function headerProblem(relPath, text) {
    const ext = relPath.slice(relPath.lastIndexOf('.'));
    const form = Object.hasOwn(HEADER_FORMS, ext) ? HEADER_FORMS[ext] : null;
    if (form === null)
        return 'unsupported file type';
    const lines = text.split('\n');
    let at = 0;
    if (form.before) {
        if (!form.before.test(lines[0] ?? ''))
            return `line 1 must be ${ext === '.sh' ? 'the shebang' : 'the XML declaration'}, with the licence header right after it`;
        at = 1;
    }
    const licence = new RegExp(`^${form.open}SPDX-License-Identifier: Apache-2\\.0${form.close}$`);
    const copyright = new RegExp(`^${form.open}SPDX-FileCopyrightText: (20[2-9]\\d) ${HOLDER}${form.close}$`);
    if (!licence.test(lines[at] ?? ''))
        return `line ${at + 1} is not the licence line "SPDX-License-Identifier: Apache-2.0" in ${ext} comment syntax`;
    const year = copyright.exec(lines[at + 1] ?? '');
    if (!year)
        return `line ${at + 2} is not the copyright line "SPDX-FileCopyrightText: <year> ${HOLDER}" in ${ext} comment syntax`;
    if (Number(year[1]) < FIRST_YEAR)
        return `copyright year ${year[1]} is before ${FIRST_YEAR}`;
    return null;
}
