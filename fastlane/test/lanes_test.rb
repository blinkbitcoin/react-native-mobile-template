# Unit tests for the helpers in fastlane/lanes/shared.rb.
#
# Run: bundle exec ruby -Ifastlane/test fastlane/test/lanes_test.rb
# (also `make check-release`). stubs.rb must be loaded first: it defines the
# `UI` and fastlane-action constants shared.rb refers to.
require 'minitest/autorun'
require 'tempfile'
require 'stubs'

require_relative '../lanes/shared'

class LanesTest < Minitest::Test
  def setup
    UI.reset!
    @env = ENV.to_h
  end

  def teardown
    ENV.replace(@env)
  end

  def write_file(contents)
    file = Tempfile.new('lanes-test')
    file.write(contents)
    file.close
    @tempfiles ||= []
    @tempfiles << file
    file.path
  end

  # ---------- require_env! ----------

  def test_require_env_passes_when_all_present
    ENV['A_SET'] = 'yes'
    require_env!(%w[A_SET])
  end

  def test_require_env_raises_for_missing_and_blank_keys
    ENV['A_SET'] = 'yes'
    ENV['B_BLANK'] = '   '
    ENV.delete('C_ABSENT')
    error = assert_raises(UI::UserError) { require_env!(%w[A_SET B_BLANK C_ABSENT]) }
    assert_includes error.message, 'B_BLANK'
    assert_includes error.message, 'C_ABSENT'
    refute_includes error.message, 'A_SET'
    assert_includes error.message, 'docs/release-runbook.md'
  end

  # ---------- store_notes ----------

  def test_store_notes_returns_text_unchanged_when_within_limit
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file("  Faster search and fewer crashes.\n")
    assert_equal 'Faster search and fewer crashes.', store_notes(500)
  end

  def test_store_notes_truncates_at_a_word_boundary_with_suffix
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file(('word ' * 60).strip)
    notes = store_notes(100)

    assert notes.length <= 100, "expected <= 100 characters, got #{notes.length}"
    assert notes.end_with?(' [+more on GitHub]'), notes
    # Truncation must not split a word: everything before the suffix is whole words.
    body = notes.sub(' [+more on GitHub]', '')
    assert_equal body.split.map(&:length).uniq, [4]
    refute_match(/\s\z/, body)
  end

  def test_store_notes_raises_when_the_file_is_not_configured
    ENV.delete('RELEASE_NOTES_STORE_FILE')
    assert_raises(KeyError) { store_notes(500) }
  end

  # ---------- build_info ----------

  def build_info_env(version:, build_number:, info:)
    ENV['APP_VERSION'] = version
    ENV['APP_BUILD_NUMBER'] = build_number
    ENV['BUILD_INFO_FILE'] = write_file(JSON.generate(info))
  end

  def test_build_info_returns_the_parsed_file_when_it_matches
    build_info_env(version: '1.2.3', build_number: '42', info: { 'version' => '1.2.3', 'buildNumber' => 42, 'sha' => 'abc' })
    assert_equal 'abc', build_info['sha']
  end

  def test_build_info_raises_on_a_version_mismatch
    build_info_env(version: '1.2.3', build_number: '42', info: { 'version' => '1.2.4', 'buildNumber' => 42 })
    error = assert_raises(UI::UserError) { build_info }
    assert_includes error.message, '1.2.4'
    assert_includes error.message, '1.2.3'
  end

  def test_build_info_raises_on_a_build_number_mismatch
    build_info_env(version: '1.2.3', build_number: '42', info: { 'version' => '1.2.3', 'buildNumber' => 43 })
    error = assert_raises(UI::UserError) { build_info }
    assert_includes error.message, '43'
  end

  # ---------- store_action ----------

  def test_store_action_calls_the_real_action_by_default
    ENV.delete('DRY_RUN')
    result = store_action(:upload_to_testflight, ipa: '/tmp/App.ipa', groups: ['QA'])

    assert_equal [[:upload_to_testflight, { ipa: '/tmp/App.ipa', groups: ['QA'] }]], $calls
    assert_nil result
  end

  def test_store_action_passes_no_arguments_through
    ENV.delete('DRY_RUN')
    store_action(:setup_ci)
    assert_equal [[:setup_ci, {}]], $calls
  end

  def test_store_action_logs_and_skips_the_action_under_dry_run
    ENV['DRY_RUN'] = '1'
    result = store_action(:upload_to_play_store, track: 'internal', aab: '/tmp/app.aab')

    assert_empty $calls, 'DRY_RUN=1 must not call the action'
    assert_equal [], result
    assert_equal 1, UI.messages.length
    assert_equal '[dry-run] upload_to_play_store {"track":"internal","aab":"/tmp/app.aab"}', UI.messages.first
  end

  def test_store_action_is_only_disabled_by_an_exact_dry_run_flag
    ENV['DRY_RUN'] = 'true'
    store_action(:match)
    assert_equal [[:match, {}]], $calls
  end
end
