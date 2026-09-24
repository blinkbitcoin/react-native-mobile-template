# Changelog

All notable changes to this project are documented here. The file is generated
by [release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/) — edit the commit
messages, not this file. See [docs/release-runbook.md](docs/release-runbook.md).

## [0.7.0](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.6.2...v0.7.0) (2026-09-23)


### Features

* **ci:** draft the store notes into the release PR and take the LLM out of the CD lanes ([#57](https://github.com/blinkbitcoin/react-native-mobile-template/issues/57)) ([47c2d42](https://github.com/blinkbitcoin/react-native-mobile-template/commit/47c2d42f4900c2f076992bec9a4315c11a3c7f79))


### Bug Fixes

* **release:** keep the store-notes marker out of the stores, and move the prompt to the repo root ([#56](https://github.com/blinkbitcoin/react-native-mobile-template/issues/56)) ([bae8533](https://github.com/blinkbitcoin/react-native-mobile-template/commit/bae8533b5fec3e235cb26354b37c2518d7426c6e))
* **tooling:** run every make ci gate in CI, and add zizmor and gitleaks ([#61](https://github.com/blinkbitcoin/react-native-mobile-template/issues/61)) ([05bd9be](https://github.com/blinkbitcoin/react-native-mobile-template/commit/05bd9be6b544f43e8520b94397bf01115f598676))

## [0.6.2](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.6.1...v0.6.2) (2026-09-21)


### Bug Fixes

* **tooling:** close the last CodeQL alert in code, and make the local gate run ([#54](https://github.com/blinkbitcoin/react-native-mobile-template/issues/54)) ([2e9fea1](https://github.com/blinkbitcoin/react-native-mobile-template/commit/2e9fea1906aa162abaed36cecfed455429f81034))

## [0.6.1](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.6.0...v0.6.1) (2026-09-21)


### Bug Fixes

* **tooling:** close the five CodeQL alerts on main ([#52](https://github.com/blinkbitcoin/react-native-mobile-template/issues/52)) ([5f5811b](https://github.com/blinkbitcoin/react-native-mobile-template/commit/5f5811b9fc1e780443fcb79bb21997341c89f254))

## [0.6.0](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.5.0...v0.6.0) (2026-09-21)


### Features

* **release:** run Huawei AppGallery on the internal and beta tiers as well ([#46](https://github.com/blinkbitcoin/react-native-mobile-template/issues/46)) ([a869246](https://github.com/blinkbitcoin/react-native-mobile-template/commit/a869246f32b39b7c0ca30bb65f796956fd0d54e4))


### Bug Fixes

* **tooling:** rename the store setup flows guide on make init ([#50](https://github.com/blinkbitcoin/react-native-mobile-template/issues/50)) ([ef04752](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ef047528f4671f9548f030d35980b96e681923b6))

## [0.5.0](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.4.0...v0.5.0) (2026-09-20)


### Features

* **release:** store listing sync and pull lanes behind STORE_METADATA_SYNC_ENABLED ([#42](https://github.com/blinkbitcoin/react-native-mobile-template/issues/42)) ([c15e99b](https://github.com/blinkbitcoin/react-native-mobile-template/commit/c15e99b9787b421a54b5e8d855e1ff93258c7fbe))
* **tooling:** store setup skills for taking a new app to a submittable listing ([#43](https://github.com/blinkbitcoin/react-native-mobile-template/issues/43)) ([8c2c057](https://github.com/blinkbitcoin/react-native-mobile-template/commit/8c2c057477b41c0c8aaabb588e9fc8cb1fa9f159))

## [0.4.0](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.3.2...v0.4.0) (2026-09-19)


### Features

* **release:** reserve the build tag at push time, while the commit is still main's tip ([#40](https://github.com/blinkbitcoin/react-native-mobile-template/issues/40)) ([d6fd36d](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d6fd36d953f169996d94c310602d5a302bee685a))

## [0.3.2](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.3.1...v0.3.2) (2026-09-19)


### Bug Fixes

* **web:** export production bytes on pull requests, not a dev export ([#38](https://github.com/blinkbitcoin/react-native-mobile-template/issues/38)) ([f81b75e](https://github.com/blinkbitcoin/react-native-mobile-template/commit/f81b75e047522f5924f0fc5afaf3a1d53963b704)), closes [#36](https://github.com/blinkbitcoin/react-native-mobile-template/issues/36)

## [0.3.1](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.3.0...v0.3.1) (2026-09-19)


### Bug Fixes

* **ci:** queue CI on main per commit, so a merge never evicts the previous one ([#33](https://github.com/blinkbitcoin/react-native-mobile-template/issues/33)) ([3c3ec86](https://github.com/blinkbitcoin/react-native-mobile-template/commit/3c3ec860d9134d286f4d58159f019362418fd55b))

## [0.3.0](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.2.6...v0.3.0) (2026-09-19)


### Features

* **release:** let beta dispatch the internal build it is missing ([#32](https://github.com/blinkbitcoin/react-native-mobile-template/issues/32)) ([5c6a1a1](https://github.com/blinkbitcoin/react-native-mobile-template/commit/5c6a1a1f7e5cc5d143b05c1e691c6ac3ea0a56d6))


### Bug Fixes

* **ci:** queue the internal release per commit, so a second push never evicts it ([#30](https://github.com/blinkbitcoin/react-native-mobile-template/issues/30)) ([9419246](https://github.com/blinkbitcoin/react-native-mobile-template/commit/941924690b77661d54ebc38d19dd6f6607ba20f2))

## [0.2.6](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.2.5...v0.2.6) (2026-09-19)


### Bug Fixes

* **e2e:** preview the web export the way GitHub Pages serves it ([#28](https://github.com/blinkbitcoin/react-native-mobile-template/issues/28)) ([1eb3037](https://github.com/blinkbitcoin/react-native-mobile-template/commit/1eb30379fdf618d3e2f47395a8d8900a6988608f))

## [0.2.5](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.2.4...v0.2.5) (2026-09-19)


### Bug Fixes

* **web:** serve the Pages site from its sub-path, boot the router on deep links, name the job Web ([#25](https://github.com/blinkbitcoin/react-native-mobile-template/issues/25)) ([7e17216](https://github.com/blinkbitcoin/react-native-mobile-template/commit/7e17216f0202a84adcabd62f419c1f2f8922fa66))

## [0.2.4](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.2.3...v0.2.4) (2026-09-18)


### Bug Fixes

* **ci:** make the beta retry listen for the workflow's display name ([#23](https://github.com/blinkbitcoin/react-native-mobile-template/issues/23)) ([ef649b4](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ef649b415dd6fd5a25b0c5a859460c78e3275bf6))
* **e2e:** answer the web bundle's GraphQL calls from the mock, whatever host it was built for ([#22](https://github.com/blinkbitcoin/react-native-mobile-template/issues/22)) ([0cedca5](https://github.com/blinkbitcoin/react-native-mobile-template/commit/0cedca58f03cc4d0c017ef410ddf95db6ef00f14))

## [0.2.3](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.2.2...v0.2.3) (2026-09-18)


### Bug Fixes

* **ci:** read the release PR's branch in the shell, not with fromJSON in env ([#20](https://github.com/blinkbitcoin/react-native-mobile-template/issues/20)) ([c172946](https://github.com/blinkbitcoin/react-native-mobile-template/commit/c172946a40347af7eb74acd968bae6e0b3ef0a35))

## [0.2.2](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.2.1...v0.2.2) (2026-09-18)


### Bug Fixes

* make the CI and CD pipelines actually run ([#7](https://github.com/blinkbitcoin/react-native-mobile-template/issues/7)) ([7bc692a](https://github.com/blinkbitcoin/react-native-mobile-template/commit/7bc692aac1447c5b9ebee8b4b3862bea141ad520))
* **native:** give Gradle the Metaspace a release build needs; gate the pre-release on both builds ([#18](https://github.com/blinkbitcoin/react-native-mobile-template/issues/18)) ([136f68a](https://github.com/blinkbitcoin/react-native-mobile-template/commit/136f68a936244fdb26cd9f4fe3d43ccd21c2fc16))
* **release:** sign the unsigned APK with the bundle's own debug key ([#12](https://github.com/blinkbitcoin/react-native-mobile-template/issues/12)) ([e2f83da](https://github.com/blinkbitcoin/react-native-mobile-template/commit/e2f83da75570734ef76879926d216b62454db5ef))

## [0.2.1](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.2.0...v0.2.1) (2026-09-17)


### Bug Fixes

* **ci:** grant CodeQL the permissions its analyze job asks for ([da8dcdb](https://github.com/blinkbitcoin/react-native-mobile-template/commit/da8dcdbad2519cc6f9efb88155ea3c8931abca02))
* **docs:** make the mermaid gate render on CI instead of warning ([#5](https://github.com/blinkbitcoin/react-native-mobile-template/issues/5)) ([58a33a4](https://github.com/blinkbitcoin/react-native-mobile-template/commit/58a33a4bbe3c6847ca37231323b734c296ddbdb5))

## [0.2.0](https://github.com/blinkbitcoin/react-native-mobile-template/compare/v0.1.0...v0.2.0) (2026-09-16)


### Features

* **ci:** separate CI from CD in the UI, and fail fast ([c2bcc97](https://github.com/blinkbitcoin/react-native-mobile-template/commit/c2bcc97dd087d9f1b18635e3dd65d0178e2f0d99))


### Bug Fixes

* **tooling:** make init drop the template's own changelog ([92d0a09](https://github.com/blinkbitcoin/react-native-mobile-template/commit/92d0a0920d2dc09802aa26f0bc2bd15633619596))

## 0.1.0 (2026-09-16)


### Features

* **app:** add logger, errors, storage, secure-store and crash-reporting slot ([b9c05c7](https://github.com/blinkbitcoin/react-native-mobile-template/commit/b9c05c79f361b59008902ed7a2bf6051accc978d))
* **app:** auth + updates services, dev menu and error boundary ([c9382ed](https://github.com/blinkbitcoin/react-native-mobile-template/commit/c9382ed9ddcec46be17bba9213c760f3c56d4ab2))
* **app:** expo router skeleton with tabs and details route ([bfcb0c2](https://github.com/blinkbitcoin/react-native-mobile-template/commit/bfcb0c2eee4140c1eba965a191fb68c61ccec603))
* **app:** splash, icon, bundled font and deep link handling ([3ebd6d6](https://github.com/blinkbitcoin/react-native-mobile-template/commit/3ebd6d6cead067b3c8990ac2671493093857c3fd))
* **ci:** expose the docs gate to ci as a check:docs script ([bd44cd3](https://github.com/blinkbitcoin/react-native-mobile-template/commit/bd44cd39f435982f7a51a4af222100a16cbbc1ee))
* **ci:** publish per-branch badges and point the README at them ([233571d](https://github.com/blinkbitcoin/react-native-mobile-template/commit/233571d9ad7149b9805ad2189439d036411d9e37))
* **ci:** scan with codeql on push, pr and a weekly cron ([d16192d](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d16192ddaddd449f944cffaf9e4d3970e62cf41f))
* **config:** app.config.ts with variants, zod-validated public env ([963bbe0](https://github.com/blinkbitcoin/react-native-mobile-template/commit/963bbe076c6ef55dac70ce2d36d00a2ebc9a9afe))
* **graphql:** apollo client 4 with typed documents and a mock schema server ([ef74fa6](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ef74fa6979899e19869d0638ea0415b290b875f9))
* **i18n:** lingui with compiled en/es catalogs and drift check ([41cfc8d](https://github.com/blinkbitcoin/react-native-mobile-template/commit/41cfc8da1ae4a0b6dfdf9f16ad5154a1b538bb06))
* **native:** local Expo Module hello-native with Swift and Kotlin ([3495533](https://github.com/blinkbitcoin/react-native-mobile-template/commit/34955336597ae7f67480823bea5e5573dde1fb19))
* **plugins:** build-stamp, Android release signing and ABI config plugins with prebuild check ([2c914c5](https://github.com/blinkbitcoin/react-native-mobile-template/commit/2c914c569faa5de318b7fa63c74de7ccedaaeaef))
* **release:** build Android without a keystore, and wire both platforms ([b9073f1](https://github.com/blinkbitcoin/react-native-mobile-template/commit/b9073f10712bfbc261128b4bea1e34b184e4e12a))
* **release:** fastlane skeleton with shared helpers, metadata as code and lane tests ([fff36dd](https://github.com/blinkbitcoin/react-native-mobile-template/commit/fff36dd59cfb656c9f1e71a31df28eae6ad95b89))
* **release:** ios and android fastlane lanes with unit-tested promotion logic ([7a522a1](https://github.com/blinkbitcoin/react-native-mobile-template/commit/7a522a187fd02788242b5542da0dbc961dde305a))
* **release:** ios and android verification gates ([53cc8b0](https://github.com/blinkbitcoin/react-native-mobile-template/commit/53cc8b0d758d0f8a0ec1ccade2cf146dac63b12a))
* **release:** make store uploads optional so the rest of the path can run ([4671179](https://github.com/blinkbitcoin/react-native-mobile-template/commit/4671179edf884e20c8f8b88a72cfd1f7d173636a))
* **release:** store release notes generator with optional llm rewrite ([2d050f3](https://github.com/blinkbitcoin/react-native-mobile-template/commit/2d050f37902cad129ab023fed956bcd3a4fc1811))
* **release:** version resolution, build info, fingerprint and OTA toggle ([d7151fb](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d7151fb692d0877b1f07b389e27fab43bd404155))
* **tooling:** add make codeql, a local run of the same queries ci runs ([296a2dc](https://github.com/blinkbitcoin/react-native-mobile-template/commit/296a2dc603e358c7efe29e1a0d97f022665aaed4))
* **tooling:** derive every port from APP_PORT_BASE ([cf65d84](https://github.com/blinkbitcoin/react-native-mobile-template/commit/cf65d84df2d27994ed13ae2777c059dbdf4ca334))
* **tooling:** fail on markdown table cells wider than 120 characters ([536e305](https://github.com/blinkbitcoin/react-native-mobile-template/commit/536e30528cf2d4c4700edce5029ec480728ac68f))
* **tooling:** make check is the CI gate set, make ci is the local CI run ([fb4b152](https://github.com/blinkbitcoin/react-native-mobile-template/commit/fb4b1523c51c6ec75d8eaa1f7faa58f097fedf4e))
* **tooling:** make init renames the project and can strip the web target ([a43dd46](https://github.com/blinkbitcoin/react-native-mobile-template/commit/a43dd4624f42242347c67cab4a2cd8976bae6bf6))
* **tooling:** make this repo's gates the ones CI runs, and strict enough for it ([94018f6](https://github.com/blinkbitcoin/react-native-mobile-template/commit/94018f63fb3ff8d001b701a213087a0302e33c2c))
* **tooling:** parse-check every fenced mermaid block in the docs ([e35e772](https://github.com/blinkbitcoin/react-native-mobile-template/commit/e35e772034faf53f4169965fb593a4c6171317c4))
* **tooling:** render CI badges from the measured coverage ([d876e07](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d876e07eb3dacb243ca29cff77b9b972e82c6809))
* **tooling:** strict agents-guide check ([62ff7e8](https://github.com/blinkbitcoin/react-native-mobile-template/commit/62ff7e89ed4531b427ce8f03151dca9984404634))
* **tooling:** tell a structural package.json change from a dependency bump ([23ed5d6](https://github.com/blinkbitcoin/react-native-mobile-template/commit/23ed5d680116ad93677b6acbd295f72369a393c6))
* **tooling:** wire the table-width and mermaid checks into make check-docs ([ed386dd](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ed386dde97c936208ddfb571c6466540497ec332))
* **ui:** theme tokens, ThemeProvider and createStyles ([0346b63](https://github.com/blinkbitcoin/react-native-mobile-template/commit/0346b63a09c9bfc6ae008f3ed07d830aebf9712a))


### Bug Fixes

* **app:** catch fire-and-forget rejections and share the provider stack ([abc766f](https://github.com/blinkbitcoin/react-native-mobile-template/commit/abc766fe17215e0b8085c1d2dcb44b3878a79dda))
* **app:** give the jest suites a 15s timeout ([67f2b5c](https://github.com/blinkbitcoin/react-native-mobile-template/commit/67f2b5c278f5e47c54d5cc9fdba67254c6cc7799))
* **app:** hook script robustness and native card coverage ([b54a384](https://github.com/blinkbitcoin/react-native-mobile-template/commit/b54a384fabe0aabead6049372b3341b6740ab7e5))
* **app:** polish parked review items ([ec6891e](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ec6891e9a2f4901d175bacbc5f1525fb7309f94f))
* **app:** register auth sign-out hook in the app and simplify typos hook ([9a6be73](https://github.com/blinkbitcoin/react-native-mobile-template/commit/9a6be73bdc3f54c8b0fda25b6dce7bfc5b0f69ae))
* **ci:** drop paths-ignore, let the classifier decide on pushes ([8afc5fe](https://github.com/blinkbitcoin/react-native-mobile-template/commit/8afc5fe350c2e2c123e84fb7eb1d816a0a6a02ad))
* **ci:** make the docs-freshness heuristic reachable in a shallow checkout ([d184bbd](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d184bbda9350ac705e083ffc34e755762172f7be))
* **ci:** one release queue, and a release body that records what shipped ([a19ee23](https://github.com/blinkbitcoin/react-native-mobile-template/commit/a19ee238b2dc66e169975d91d70244b96acb3393))
* **ci:** production export on release; document forensics artifact names ([ca4d2ad](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ca4d2ad6a9223fb09025a931a82b8f8d227813f9))
* **deps:** bump the eleven Expo packages that are old enough to install ([6f0bae2](https://github.com/blinkbitcoin/react-native-mobile-template/commit/6f0bae2dc9a4f1ce390e426f5e720efb371d8ca4))
* **e2e:** dismiss the dev-menu sheet with back on android ([d18ca75](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d18ca7556984c847649fe601bf53824da45b8be7))
* **e2e:** launch the dev client by deep link ([1b7596b](https://github.com/blinkbitcoin/react-native-mobile-template/commit/1b7596b894a35ec8665764d03256dbc7d18adf5a))
* **e2e:** platform-guard back navigation in maestro flows ([b2316e3](https://github.com/blinkbitcoin/react-native-mobile-template/commit/b2316e3abd4651ef5e8f547280496ff8c31fa0d0))
* **native:** make getBuildStamp reject instead of throw; guard update checks ([da4abf1](https://github.com/blinkbitcoin/react-native-mobile-template/commit/da4abf10d0cf2747a9326d7db2b08fdcd2efbcb8))
* **plugins:** fail loudly when release signing cannot be rewritten ([f981c6d](https://github.com/blinkbitcoin/react-native-mobile-template/commit/f981c6df444bbe9711aefe0886dbf7ccbe041bfd))
* **release:** check the two OTA settings that decide whether updates arrive ([d69bc2e](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d69bc2e3d3d6e55d10b12b1e6e4bc847cc9315b8))
* **release:** clean store-notes overrides and tighten llm validation ([8cc0f2f](https://github.com/blinkbitcoin/react-native-mobile-template/commit/8cc0f2f8b62c5855da05d1ef806cbc37c67ff0c8))
* **release:** follow the release branch and refuse a bad build offset ([fe75a99](https://github.com/blinkbitcoin/react-native-mobile-template/commit/fe75a990eac7ee6827cef29583f76c490a00e6c7))
* **release:** forward build env, tag-scoped beta, separate concurrency groups ([2ab0956](https://github.com/blinkbitcoin/react-native-mobile-template/commit/2ab09565ef037a362b66c1c88e6020d4e0c2ac70))
* **release:** harden shared fastlane helpers and secret ignores ([9e9a40f](https://github.com/blinkbitcoin/react-native-mobile-template/commit/9e9a40f84e397d2aa5ff0b9da7a84590e9608f63))
* **release:** honour NOTES_LOCALES and document the names lanes actually read ([9d1ed87](https://github.com/blinkbitcoin/react-native-mobile-template/commit/9d1ed87aac4d838afb3b1f182ba63129eb06d1cd))
* **release:** make the fingerprint config load and harden version resolution ([0ce15d4](https://github.com/blinkbitcoin/react-native-mobile-template/commit/0ce15d4d7eedaa9452cc3c9790dfdb5446c4fab7))
* **release:** ota verify checks match what prebuild actually writes ([182e568](https://github.com/blinkbitcoin/react-native-mobile-template/commit/182e568d4b8bb1f602d7d497c1ea7fccb2527a54))
* **release:** placeholder cert hash matches the committed certificate ([d7bfb8a](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d7bfb8a3de634e9ddef5efd2da192ca600a1af00))
* **release:** polish parked lane minors ([f7a13b8](https://github.com/blinkbitcoin/react-native-mobile-template/commit/f7a13b8c17a7b0a0d13e8fdde39c58e023eeae92))
* **release:** read upload artifacts from the download directory ([6a288d1](https://github.com/blinkbitcoin/react-native-mobile-template/commit/6a288d1ca41b47095fa33b2dde399be814e2ffe5))
* **release:** resolve the release version through a merge commit too ([89d898f](https://github.com/blinkbitcoin/react-native-mobile-template/commit/89d898f01963ee8a0ff2bdf1fa71a46c8e2705d2))
* **release:** sound dev-server check on hermes, strict mode and per-check skips ([a7f7e5e](https://github.com/blinkbitcoin/react-native-mobile-template/commit/a7f7e5e2adcb86dd3177cf6cb13011c38ec60081))
* **release:** stamp the release commit with the version it releases ([4bf04d0](https://github.com/blinkbitcoin/react-native-mobile-template/commit/4bf04d095f15053f15a69a7ecde94252fad1cfaa))
* **release:** string rollout, opt-in beta review info, option-validated lane tests ([4640952](https://github.com/blinkbitcoin/react-native-mobile-template/commit/464095274a27c6001699bae6fdec79995eba6c5c))
* **tooling:** a broken diagram can no longer switch the mermaid gate off ([6922b57](https://github.com/blinkbitcoin/react-native-mobile-template/commit/6922b57d47cbb0304b0d2e50160dfea3df9cac64))
* **tooling:** cover the codeql config and ci.md's new counts in the manifest ([b0d63a3](https://github.com/blinkbitcoin/react-native-mobile-template/commit/b0d63a3082186eb9916d42ce9302b49cabb53c5d))
* **tooling:** credit textLength for the badge box, and pin the centring ([8062389](https://github.com/blinkbitcoin/react-native-mobile-template/commit/806238949902b93a71b1d8014ab95c933f9dc866))
* **tooling:** do not delete the initialiser before the steps that can fail ([9e82836](https://github.com/blinkbitcoin/react-native-mobile-template/commit/9e82836b4fa59219918ab8079cb33c7322c3e311))
* **tooling:** doctor prints the real reason a command check failed ([f527638](https://github.com/blinkbitcoin/react-native-mobile-template/commit/f527638a5e06819ba718c8f90ef6e779effeace2))
* **tooling:** drop a count that goes stale, hush a dull notice, and fix the typos hook ([ce26a61](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ce26a6173d5d2d4f58d8b6b4d96c2feba783d9c0))
* **tooling:** drop the web export from the codeql exclusions on --no-web ([d42aed5](https://github.com/blinkbitcoin/react-native-mobile-template/commit/d42aed5762cbd4d959a7d350b2ed4a203025fb01))
* **tooling:** honor AND license expressions; guard empty bundle ([8055408](https://github.com/blinkbitcoin/react-native-mobile-template/commit/80554080c4fda6a30797619b0ab5a2a5c1c70313))
* **tooling:** init renames the github owner and finishes the --no-web strip ([432233b](https://github.com/blinkbitcoin/react-native-mobile-template/commit/432233b3a45a062b44cff0384c24830cdfcf88ba))
* **tooling:** init validates before mutating and scrubs only what it matched ([0597f23](https://github.com/blinkbitcoin/react-native-mobile-template/commit/0597f23a5fcdc448e21229177cc1fb2fe6b8a229))
* **tooling:** keep react/no-unknown-property in ESLint ([bda76cf](https://github.com/blinkbitcoin/react-native-mobile-template/commit/bda76cf414c138ed5064dd4711f13b51eaaa3247))
* **tooling:** make install sets up the ruby gems and doctor checks them ([aa06cf7](https://github.com/blinkbitcoin/react-native-mobile-template/commit/aa06cf749201eff81f514db1b07b1a3bb9d2c39d))
* **tooling:** remove Biome/ESLint rule overlap ([ffc7c17](https://github.com/blinkbitcoin/react-native-mobile-template/commit/ffc7c17dc44ca44dfdceb8192479396c596aa43c))
* **tooling:** run knip in default mode and drop masking ignores ([db55406](https://github.com/blinkbitcoin/react-native-mobile-template/commit/db55406a0fb1c76a2b196814d48f24a287105041))
* **tooling:** stop codeql-local silently dropping suites and packs ([7ab91b1](https://github.com/blinkbitcoin/react-native-mobile-template/commit/7ab91b1c99bc660342a20ffd80d743cf879144ea))
* **tooling:** unmask and repair the two stale init snapshots ([28c62d6](https://github.com/blinkbitcoin/react-native-mobile-template/commit/28c62d64de5e3aa3aebd20831b418969ed03b082))
* **tooling:** use plain jest transform entry for lingui esm ([2bc7c18](https://github.com/blinkbitcoin/react-native-mobile-template/commit/2bc7c18ad0e1b7194c151b08dce97fd7739dac51))


### Miscellaneous

* **release:** pin the first published version to 0.1.0 ([1dc9c9b](https://github.com/blinkbitcoin/react-native-mobile-template/commit/1dc9c9b2f12e12c8cdbbd5279073503ddede52fb))

## 0.0.0 (2026-09-06)

### Miscellaneous

* Initial template. The version stays `0.0.0` until the first release-please
  release PR is merged in a repository generated from this template; the
  `.release-please-manifest.json` entry and `package.json` `version` are kept in
  step by release-please from then on.
