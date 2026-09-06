# Human/agent command surface. Thin wrappers over pnpm scripts and scripts/.
# `make` or `make help` lists targets; every target has a `##` description.
.DEFAULT_GOAL := help
SHELL := /bin/bash

# ---------- Setup ----------
doctor: ## Check the local toolchain (run this first)
	node scripts/doctor.mjs

install: ## Install dependencies (frozen lockfile) and git hooks
	pnpm install --frozen-lockfile

# ---------- Run ----------
start: ## Metro for the dev client
	pnpm start

ios: ## Prebuild if needed, build and launch on the iOS simulator
	pnpm ios

android: ## Prebuild if needed, build and launch on an Android emulator
	pnpm android

web: ## Expo web dev server (web target)
	pnpm web

mock-api: ## Local GraphQL mock API on :4000
	pnpm mock-api

prebuild: ## Regenerate ios/ and android/ locally (debugging plugins only; never commit them)
	pnpm prebuild

build-web: ## Static web export into dist/
	pnpm build:web

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

unit: ## Unit + component tests
	pnpm test

coverage: ## Tests with coverage thresholds (what CI enforces)
	pnpm test:coverage

# ---------- End-to-end ----------
e2e-ios: ## Maestro flows on iOS (needs: make mock-api, make start, make ios)
	pnpm test:e2e:ios

e2e-android: ## Maestro flows on Android (needs: make mock-api, make start, make android)
	pnpm test:e2e:android

e2e-web: ## Web export (dev env, mock API) + Playwright smoke
	pnpm test:e2e:web

test: unit check-code ## Unit tests + code checks

clean: ## Remove generated native projects, caches and build output
	rm -rf ios android .expo dist coverage node_modules/.cache

reset: clean ## clean + reinstall
	rm -rf node_modules && pnpm install --frozen-lockfile

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

.PHONY: doctor install start ios android web mock-api prebuild build-web i18n codegen typecheck lint format format-check knip spell check-gen check-prebuild check-code unit coverage e2e-ios e2e-android e2e-web test clean reset help
