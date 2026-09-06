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

prebuild: ## Regenerate ios/ and android/ locally (debugging plugins only; never commit them)
	pnpm prebuild

# ---------- Codegen ----------
i18n: ## Extract + compile message catalogs
	pnpm i18n:extract

# ---------- Quality gates (each is what CI runs) ----------
typecheck: ## tsc --noEmit
	pnpm typecheck

lint: ## Biome lint + ESLint (React/Expo rules)
	pnpm lint

format: ## Format everything with Biome (writes)
	pnpm format

format-check: ## Check formatting without writing
	pnpm format:check

knip: ## Unused files, exports and dependencies
	pnpm knip

spell: ## Spell-check with typos
	pnpm spell

check-gen: ## Generated-file drift (i18n, codegen)
	pnpm i18n:check

check-code: typecheck lint format-check knip spell ## Fast local gate: types + lint + format + knip + spell

unit: ## Unit + component tests
	pnpm test

coverage: ## Tests with coverage thresholds (what CI enforces)
	pnpm test:coverage

test: unit check-code ## Unit tests + code checks

clean: ## Remove generated native projects, caches and build output
	rm -rf ios android .expo dist coverage node_modules/.cache

reset: clean ## clean + reinstall
	rm -rf node_modules && pnpm install --frozen-lockfile

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

.PHONY: doctor install start ios android web prebuild i18n typecheck lint format format-check knip spell check-gen check-code unit coverage test clean reset help
