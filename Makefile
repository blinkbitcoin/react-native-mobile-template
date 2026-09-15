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

release-notes: ## Preview store notes for HEAD (TAG=vX.Y.Z uses that release body via gh)
	@set -euo pipefail; \
	if [ -n "$(TAG)" ]; then \
		body="$$(mktemp)"; \
		trap 'rm -f "$$body"' EXIT; \
		gh release view "$(TAG)" --json body -q .body > "$$body" \
			|| { echo "gh release view $(TAG) failed" >&2; exit 1; }; \
		[ -s "$$body" ] || { echo "empty release body for $(TAG)" >&2; exit 1; }; \
		node scripts/release/notes.mjs --from-body "$$body" --body-section --out -; \
	else \
		node scripts/release/notes.mjs --from-commits --out -; \
	fi

# ---------- Codegen ----------
i18n: ## Extract + compile message catalogs
	pnpm i18n:extract

codegen: ## Regenerate typed GraphQL documents
	pnpm codegen

# ---------- Quality gates (each is what CI runs) ----------
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

check-ci: ## Lint the CI itself: actionlint (workflows) + shellcheck (scripts)
	bash scripts/shellcheck.sh
	@if [ -d .github/workflows ]; then actionlint; else echo "no workflows yet"; fi

check-docs: ## Docs freshness + AGENTS.md command table
	bash scripts/check-docs.sh

bundle-secrets-check: ## Export the bundle and assert no non-public keys leaked
	pnpm check-bundle-secrets

check-release: ## Ruby syntax + fastlane lane parse + lane unit tests
	@bundle check >/dev/null 2>&1 || { echo "run: bundle install (see docs/release-runbook.md)"; exit 1; }
	for f in fastlane/Fastfile fastlane/lanes/*.rb fastlane/test/*.rb; do ruby -c "$$f" || exit 1; done
	FASTLANE_SKIP_ENV_ASSERT=1 bundle exec fastlane lanes
	bundle exec ruby -Ifastlane/test fastlane/test/lanes_test.rb

check: check-code check-gen check-deps check-ci check-docs check-release ## Every static gate CI runs (no tests/builds)

# Deliberately NOT in `make check`: the first run downloads and compiles a query
# pack (minutes) and every run needs a CodeQL CLI, which no other gate does.
# CI runs the same queries through .github/workflows/codeql.yml.
codeql: ## CodeQL locally with the same config CI uses (needs a CodeQL CLI)
	bash scripts/codeql-local.sh

test-scripts: ## node:test for scripts/**/*.test.mjs
	pnpm test:scripts

unit: ## Unit + component tests
	pnpm test && pnpm test:scripts

coverage: ## Tests with coverage thresholds (what CI enforces)
	pnpm test:coverage
	pnpm check:coverage-empty

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

.PHONY: init doctor install ports start ios android web mock-api prebuild build-web version verify-ios verify-android release-notes i18n codegen typecheck lint format format-check knip spell check-gen check-prebuild check-code check-deps check-ci check-docs bundle-secrets-check check-release check codeql test-scripts unit coverage e2e-ios e2e-android e2e-web test clean reset help
