// The application version, in one obvious home. It is shown in the page
// footer and asserted by test/version.test.js, so the string cannot drift from
// the documented format.
//
// Semantic versioning (https://semver.org), for a game with no public API --
// read MAJOR as "changes how the game plays", MINOR as "adds something", and
// PATCH as "fixes something without changing how it plays":
//
//   MAJOR  a rules change, or anything that makes an old save/understand of
//          the game wrong (e.g. two yellow cards -> warning/red-card system)
//   MINOR  a new feature that existing play is unaffected by (e.g. the timer)
//   PATCH  a bug fix or copy/style tweak with no behavioural change
//
// Bump it here by hand as part of the change; there is no release pipeline
// rewriting it. See README.md, "Versioning".
const APP_VERSION = '1.0.0';

// No-op in the browser; a real CommonJS module in Node.
if(typeof module !== 'undefined') module.exports = { APP_VERSION };
