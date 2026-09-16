# CI-owned branch

badges/<branch>/{coverage,unit,e2e}.svg (+ their .json siblings) - written by
the badges job in the CI workflow (react-native-workflows badges.yml ->
scripts/ci/publish-badges.sh) on every run; a branch directory is removed when
its pull request closes (badges-cleanup.sh). Do not edit by hand.

This branch is NOT the GitHub Pages source. Keep the Pages source set to
"GitHub Actions": the web export deploys as a Pages artifact, and the badges
are served from raw.githubusercontent.com.
