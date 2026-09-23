# Human/agent command surface. Thin wrappers over pnpm scripts and scripts/.
# `make` or `make help` lists targets; every target has a `##` description.
.DEFAULT_GOAL := help
SHELL := /bin/bash

# Every port derives from APP_PORT_BASE (default 8080) plus a fixed offset;
# `scripts/ports.mjs` is the table and the ONLY thing that derives one. mise
# exports the base and nothing else, on purpose: a mirrored METRO_PORT in the
# environment is indistinguishable from a deliberate per-service override, and
# `APP_PORT_BASE=8090 make start` would then quietly stay on the default. So the
# run targets eval the helper, which also means they work in a shell with no
# mise activated. EXPO_PUBLIC_API_URL comes from that eval too: it is baked into
# the bundle, so .env.development stays the bare-`expo start` default.
PORTS := eval "$$(node scripts/ports.mjs --sh)"

# ---------- Setup ----------
init: ## Rename this template into your app (interactive; --yes for CI)
	node scripts/init.mjs $(ARGS)

doctor: ## Check the local toolchain (run this first)
	node scripts/doctor.mjs

# One step, both toolchains: `make check` ends in `check-release`, which needs
# the fastlane gems, so a fresh clone that only ran `pnpm install` fails a gate
# it was never told about. NO_BUNDLE=1 skips the Ruby half (CI images that
# install gems in their own step, or a machine with no ruby yet).
install: ## Install dependencies (pnpm + Ruby gems) and git hooks
	pnpm install --frozen-lockfile
	@if [ "$(NO_BUNDLE)" = "1" ]; then \
		echo "NO_BUNDLE=1: skipping bundle install (make check-release will need it)"; \
	else \
		bundle config set --local path vendor/bundle && bundle install; \
	fi

# ---------- Run ----------
ports: ## Print the ports derived from APP_PORT_BASE
	@node scripts/ports.mjs

start: ## Metro for the dev client (APP_PORT_BASE+1)
	@$(PORTS) && pnpm start --port "$$METRO_PORT"

ios: ## Prebuild if needed, build and launch on the iOS simulator
	@$(PORTS) && pnpm ios

android: ## Prebuild if needed, build and launch on an Android emulator
	@$(PORTS) && pnpm android

web: ## Expo web dev server (web target)
	@$(PORTS) && pnpm web

mock-api: ## Local GraphQL mock API (APP_PORT_BASE+2)
	@$(PORTS) && pnpm mock-api

prebuild: ## Regenerate ios/ and android/ locally (debugging plugins only; never commit them)
	pnpm prebuild

build-web: ## Static web export into dist/
	pnpm build:web

version: ## Print what CI would build for HEAD
	bash scripts/release/resolve-version.sh

# ARTIFACT, not PATH: a variable set on make's command line is exported to every
# recipe, so `make verify-ios PATH=...` would replace the shell's PATH.
verify-ios: ## Verify a built .app/.ipa/.xcarchive (ARTIFACT=... [ARGS=--no-signing])
	@[ -n "$(ARTIFACT)" ] || { echo "usage: make verify-ios ARTIFACT=artifacts/ios/App.xcarchive [ARGS=--no-signing]"; exit 2; }
	bash scripts/release/verify-ios.sh "$(ARTIFACT)" $(ARGS)

verify-android: ## Verify AAB+APK (AAB=... APK=... [ARGS=--cert-sha256 X])
	@[ -n "$(AAB)" ] && [ -n "$(APK)" ] || { echo "usage: make verify-android AAB=artifacts/android/app-release.aab APK=artifacts/android/app-universal.apk"; exit 2; }
	bash scripts/release/verify-android.sh "$(AAB)" "$(APK)" $(ARGS)

release-notes: ## Preview store notes for HEAD (TAG=vX.Y.Z uses that release body, PR=N that release PR's body)
	@set -euo pipefail; \
	if [ -n "$(TAG)" ]; then \
		body="$$(mktemp)"; \
		trap 'rm -f "$$body"' EXIT; \
		gh release view "$(TAG)" --json body -q .body > "$$body" \
			|| { echo "gh release view $(TAG) failed" >&2; exit 1; }; \
		[ -s "$$body" ] || { echo "empty release body for $(TAG)" >&2; exit 1; }; \
		node scripts/release/notes.mjs --from-body "$$body" --body-section --out -; \
	elif [ -n "$(PR)" ]; then \
		body="$$(mktemp)"; \
		trap 'rm -f "$$body"' EXIT; \
		gh pr view "$(PR)" --json body -q .body > "$$body" \
			|| { echo "gh pr view $(PR) failed" >&2; exit 1; }; \
		[ -s "$$body" ] || { echo "empty body for PR $(PR)" >&2; exit 1; }; \
		node scripts/release/notes.mjs --from-body "$$body" --body-section --out -; \
	else \
		node scripts/release/notes.mjs --from-commits --out -; \
	fi

# ---------- Codegen ----------
i18n: ## Extract + compile message catalogs
	pnpm i18n:extract

codegen: ## Regenerate typed GraphQL documents
	pnpm codegen

# ---------- Quality gates ----------
# `make check` is the `check-code` workflow's gate set and `make ci` adds the `check-unit`
# workflow's, so a green run here is the same set of gates CI makes - not a
# similar one. That used to be a comment claiming as much while five gates
# (i18n, codegen, SDK drift, lockfile provenance, licences) ran here and in no
# CI job at all. It is now enforced from the other side: consumer-contract.bats
# in shared-workflows reads this Makefile and the workflow YAML and fails
# when they disagree.
#
# E2E is the deliberate exception: it needs a simulator or an emulator, so it
# stays in its own targets (`make e2e-ios`, `e2e-android`, `e2e-web`).
typecheck: ## tsc --noEmit
	pnpm typecheck

lint: ## Biome lint + ESLint (React/Expo rules)
	pnpm lint

format: ## Format everything with Biome (writes)
	pnpm format

format-check: ## Check formatting without writing
	pnpm format:check

knip: ## Unused files, exports and dependencies (default mode; production mode flags test-only exports)
	pnpm knip

spell: ## Spell-check with typos
	pnpm spell

check-gen: ## Generated-file drift (i18n, codegen)
	pnpm i18n:check
	pnpm codegen:check

check-prebuild: ## Prebuild both platforms into a temp dir and assert plugin output
	pnpm check-prebuild

check-code: typecheck lint format-check knip spell ## Fast local gate: types + lint + format + knip + spell

check-deps: ## SDK drift, vulnerability audit, lockfile provenance, licenses
	pnpm deps:check
	pnpm deps:audit
	pnpm deps:licenses

# zizmor is the security half: injection, permissions, App token scope,
# dangerous triggers. --offline keeps the answer independent of the network.
# Policy and the one justified ignore: .github/zizmor.yml.
check-ci: ## Lint the CI itself: actionlint + zizmor (workflows) + shellcheck (scripts)
	bash scripts/shellcheck.sh
	@if [ -d .github/workflows ]; then actionlint && zizmor --offline --min-severity medium .github; else echo "no workflows yet"; fi

check-docs: ## Docs freshness, AGENTS.md command table, table widths, mermaid blocks
	bash scripts/check-docs.sh

bundle-secrets-check: ## Export the bundle and assert no non-public keys leaked
	pnpm check-bundle-secrets

# The skills' tests run here, in the recipe rather than as a prerequisite: they
# need the same Ruby and bundle, and CI's Release job runs this target by name.
# As a separate target in `check` they ran on laptops and in no CI job.
check-release: ## Ruby syntax + fastlane lane parse + lane unit tests + skill tests
	@bundle check >/dev/null 2>&1 || { echo "run: bundle install (see docs/release-runbook.md)"; exit 1; }
	for f in fastlane/Fastfile fastlane/lanes/*.rb fastlane/test/*.rb; do ruby -c "$$f" || exit 1; done
	FASTLANE_SKIP_ENV_ASSERT=1 bundle exec fastlane lanes
	bundle exec ruby -Ifastlane/test fastlane/test/lanes_test.rb
	bash scripts/check-skills.sh

check-skills: ## Only the skill tests (offline, fakes only; needs bundle install) - part of check-release
	bash scripts/check-skills.sh

# History, not the working tree: a key committed and deleted later is still in
# the repository. Allowlisted test data, each entry with its reason: .gitleaks.toml.
check-secrets: ## Scan the whole git history for committed secrets (gitleaks)
	gitleaks git --redact --no-banner .

check: check-code check-gen check-deps check-ci check-docs check-release check-secrets ## Every static gate the check-code workflow runs (no tests/builds)

# The two expensive gates are not in `check` and are off by default in CI for
# the same reason: a prebuild of both platforms and a web export are minutes
# each. Run them before a release, or when you have touched a config plugin.
check-slow: check-prebuild bundle-secrets-check ## The minutes-long gates: prebuild output + bundle secrets

ci: check coverage test-scripts ## Everything CI runs except E2E (which needs a simulator)

# Deliberately NOT in `make check`: the first run downloads and compiles a query
# pack (minutes) and every run needs a CodeQL CLI, which no other gate does.
# CI runs the same queries through .github/workflows/ci-codeql.yml.
codeql: ## CodeQL locally with the same config CI uses (needs a CodeQL CLI)
	bash scripts/codeql-local.sh

test-scripts: ## node:test for scripts/**/*.test.mjs
	pnpm test:scripts

unit: ## Unit + component tests
	pnpm test && pnpm test:scripts

coverage: ## Tests with coverage thresholds and the empty-row check (what CI enforces)
	pnpm test:coverage

# Same entry point CI calls, so what you see locally is what gh-pages gets.
# The job results default to success here; set BADGE_UNIT/BADGE_E2E to any of
# success|failure|cancelled|skipped to see the other colours.
badges: ## Render the CI badges into coverage/badge/ (run make coverage first)
	@BADGE_UNIT="$${BADGE_UNIT:-success}" BADGE_E2E="$${BADGE_E2E:-success}" pnpm badges:render

# ---------- End-to-end ----------
e2e-ios: ## Maestro flows on iOS (needs: make mock-api, make start, make ios)
	@$(PORTS) && pnpm test:e2e:ios

e2e-android: ## Maestro flows on Android (needs: make mock-api, make start, make android)
	@$(PORTS) && pnpm test:e2e:android

e2e-web: ## Web export (dev env, mock API) + Playwright smoke
	@$(PORTS) && pnpm test:e2e:web

test: unit check-code ## Unit tests + code checks

clean: ## Remove generated native projects, caches and build output
	rm -rf ios android .expo dist coverage node_modules/.cache

reset: clean ## clean + reinstall
	rm -rf node_modules && pnpm install --frozen-lockfile

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

.PHONY: init doctor install ports start ios android web mock-api prebuild build-web version verify-ios verify-android release-notes i18n codegen typecheck lint format format-check knip spell check-gen check-prebuild check-code check-deps check-ci check-docs check-skills check-secrets bundle-secrets-check check-release check check-slow ci codeql test-scripts unit coverage badges e2e-ios e2e-android e2e-web test clean reset help
