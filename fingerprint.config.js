// Fingerprint (runtimeVersion policy "fingerprint") inputs: the family's
// source skips and ignore paths, from the shared tooling. Guarded by the
// fingerprint app suite (`make test-app`), which also proves a version bump
// moves neither platform's fingerprint.
const { createFingerprintConfig } = require('@blinkbitcoin/app-tooling/expo/fingerprint');

module.exports = createFingerprintConfig();
