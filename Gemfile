# Ruby toolchain for release automation. Ruby itself is pinned in .mise.toml
# (3.3); everything below is installed with `bundle install` into vendor/bundle.
#
# - fastlane drives the store lanes in fastlane/ (see docs/release-runbook.md)
# - cocoapods is what `pod install` resolves to for the iOS project that
#   `expo prebuild` generates; react-native-workflows' scripts/native/pods.sh
#   runs `bundle exec pod install` whenever a Gemfile is present.
source 'https://rubygems.org'

gem 'cocoapods', '~> 1.16'
gem 'fastlane', '~> 2.238'

plugins_path = File.join(File.dirname(__FILE__), 'fastlane', 'Pluginfile')
eval_gemfile(plugins_path) if File.exist?(plugins_path)
