# Unit tests for fastlane/lanes/*.rb: the shared helpers, and the promotion
# logic in the iOS and Android lanes.
#
# Run: bundle exec ruby -Ifastlane/test fastlane/test/lanes_test.rb
# (also `make check-release`). stubs.rb must be loaded first: it defines the
# `UI` and fastlane-action constants shared.rb refers to, plus the
# `platform`/`lane`/`desc` DSL that turns a lane file into callable blocks.
require 'minitest/autorun'
require 'tempfile'
require 'tmpdir'
require 'fileutils'
require 'stubs'

require_relative '../lanes/shared'
require_relative '../lanes/ios'
require_relative '../lanes/android'
require_relative '../lanes/future'

class LanesTest < Minitest::Test
  def setup
    UI.reset!
    reset_calls!
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
    assert_equal [4], body.split.map(&:length).uniq
    refute_match(/\s\z/, body)
  end

  def test_store_notes_returns_text_unchanged_at_exactly_the_limit
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file('a' * 50)
    assert_equal 'a' * 50, store_notes(50)
  end

  def test_store_notes_hard_cuts_text_with_no_word_boundary
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file('a' * 200)
    notes = store_notes(50)

    assert_equal 50, notes.length
    assert notes.end_with?(' [+more on GitHub]'), notes
  end

  def test_store_notes_ignores_a_word_boundary_that_would_lose_most_of_the_window
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file("x #{'y' * 100}")
    notes = store_notes(30)

    assert_equal 30, notes.length
    assert notes.start_with?('x yyy'), notes
  end

  def test_store_notes_handles_a_limit_smaller_than_the_suffix
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file('hello world this is long')

    [1, 5, 10, 17, 18].each do |limit|
      notes = store_notes(limit)
      refute_nil notes, "limit #{limit} returned nil"
      assert_operator notes.length, :<=, limit
      refute_includes notes, '[+more on GitHub]', "limit #{limit} kept the suffix"
    end
  end

  def test_store_notes_returns_an_empty_string_for_a_zero_limit
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file('hello world this is long')
    assert_equal '', store_notes(0)
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

  # ---------- store_action: secret redaction in the dry-run log ----------

  def test_dry_run_log_redacts_a_nested_api_key
    ENV['DRY_RUN'] = '1'
    store_action(:upload_to_testflight, api_key: { key_id: 'K', key_content: 'SECRET' }, ipa: '/tmp/App.ipa')

    log = UI.messages.first
    refute_includes log, 'SECRET', 'the App Store Connect .p8 must never reach the log'
    assert_includes log, '[redacted]'
    assert_includes log, '/tmp/App.ipa'
  end

  def test_dry_run_log_redacts_every_known_secret_argument
    ENV['DRY_RUN'] = '1'
    secrets = {
      json_key_data: 'SECRET', json_key: 'SECRET', password: 'SECRET',
      key_password: 'SECRET', store_password: 'SECRET', keystore_password: 'SECRET',
      match_password: 'SECRET', token: 'SECRET', api_token: 'SECRET',
      private_key: 'SECRET', key_content: 'SECRET', demo_password: 'SECRET'
    }
    store_action(:upload_to_play_store, track: 'production', **secrets)

    log = UI.messages.first
    refute_includes log, 'SECRET', log
    assert_includes log, '"track":"production"'
  end

  def test_dry_run_log_redacts_unfamiliar_credential_shaped_names
    ENV['DRY_RUN'] = '1'
    store_action(:gradle, some_new_secret: 'SECRET', properties: { signing_password: 'SECRET' })

    refute_includes UI.messages.first, 'SECRET', UI.messages.first
  end

  def test_dry_run_log_keeps_non_secret_arguments_readable
    ENV['DRY_RUN'] = '1'
    store_action(:upload_to_play_store, track: 'internal', rollout: '0.1', aab: '/tmp/app.aab')

    assert_equal '[dry-run] upload_to_play_store {"track":"internal","rollout":"0.1","aab":"/tmp/app.aab"}',
                 UI.messages.first
  end

  # ---------- store_action: canned dry-run results ----------

  def test_dry_run_returns_the_shape_each_consumed_action_returns
    ENV['DRY_RUN'] = '1'

    assert_equal [], store_action(:google_play_track_version_codes, package_name: 'com.example')
    assert_equal 0, store_action(:latest_testflight_build_number, app_identifier: 'com.example')
    assert_nil store_action(:upload_to_testflight, ipa: '/tmp/App.ipa')
    assert_nil store_action(:upload_to_app_store, app_version: '1.2.3')
  end

  def test_dry_run_falls_back_to_an_empty_array_for_unlisted_actions
    ENV['DRY_RUN'] = '1'
    assert_equal [], store_action(:match, type: 'appstore')
  end

  def test_the_dry_run_idempotency_results_take_the_upload_path
    # An empty track and build number 0 must read as "nothing uploaded yet", or
    # a dry run would take the skip path and rehearse nothing.
    assert_empty DRY_RUN_RESULTS[:google_play_track_version_codes]
    assert_equal 0, DRY_RUN_RESULTS[:latest_testflight_build_number]
  end

  def test_api_key_needs_no_apple_credentials_under_dry_run
    ENV['DRY_RUN'] = '1'
    ENV['ASC_KEY_ID'] = 'KEYID'
    ENV['ASC_ISSUER_ID'] = 'ISSUER'
    ENV.delete('ASC_KEY_P8_BASE64')

    key = api_key
    assert key[:dry_run], 'a rehearsal must not sign a JWT with a real .p8'
    assert_empty $calls, 'app_store_connect_api_key opens a session; it must not run'
  end

  def test_api_key_builds_the_real_key_outside_a_dry_run
    ENV.delete('DRY_RUN')
    ENV['ASC_KEY_ID'] = 'KEYID'
    ENV['ASC_ISSUER_ID'] = 'ISSUER'
    ENV['ASC_KEY_P8_BASE64'] = 'BASE64'

    api_key
    args = $calls.find { |name, _| name == :app_store_connect_api_key }.last
    assert_equal 'KEYID', args[:key_id]
    assert args[:is_key_content_base64]
  end

  # ---------- truthy? / rollout_fraction ----------

  def test_truthy_accepts_the_string_fastlane_passes_from_the_cli
    assert truthy?('true'), 'fastlane passes `skip_signing:true` through as a String'
    assert truthy?(true)
    assert truthy?('1')
    refute truthy?('false')
    refute truthy?(nil)
    refute truthy?('')
  end

  def test_rollout_fraction_accepts_both_a_fraction_and_a_percentage
    assert_in_delta 0.5, rollout_fraction('0.5')
    assert_in_delta 0.5, rollout_fraction(50)
    assert_in_delta 1.0, rollout_fraction('100')
    assert_in_delta 1.0, rollout_fraction(1)
  end

  def test_rollout_fraction_rejects_values_supply_would_reject
    # supply's own verify_block requires > 0.0 and <= 1.0.
    assert_raises(UI::UserError) { rollout_fraction('0') }
    assert_raises(UI::UserError) { rollout_fraction('-1') }
    assert_raises(UI::UserError) { rollout_fraction('101') }
    assert_raises(UI::UserError) { rollout_fraction('half') }
  end

  # ---------- play_json_key_args ----------

  def test_play_credentials_prefer_inline_json_over_a_path
    ENV['PLAY_SERVICE_ACCOUNT_JSON'] = '{"type":"service_account"}'
    ENV['PLAY_SERVICE_ACCOUNT_JSON_PATH'] = '/tmp/key.json'
    assert_equal({ json_key_data: '{"type":"service_account"}' }, play_json_key_args)
  end

  def test_play_credentials_fall_back_to_a_path
    ENV.delete('PLAY_SERVICE_ACCOUNT_JSON')
    ENV['PLAY_SERVICE_ACCOUNT_JSON_PATH'] = '/tmp/key.json'
    assert_equal({ json_key: '/tmp/key.json' }, play_json_key_args)
  end

  def test_play_credentials_raise_when_neither_is_set
    ENV.delete('PLAY_SERVICE_ACCOUNT_JSON')
    ENV.delete('PLAY_SERVICE_ACCOUNT_JSON_PATH')
    error = assert_raises(UI::UserError) { play_json_key_args }
    assert_includes error.message, 'PLAY_SERVICE_ACCOUNT_JSON'
  end

  # ---------- bundletool discovery ----------

  def test_bundletool_prefers_the_executable_on_path
    Dir.mktmpdir do |dir|
      File.write(File.join(dir, 'bundletool'), '#!/bin/sh')
      FileUtils.chmod(0o755, File.join(dir, 'bundletool'))
      ENV['PATH'] = dir
      assert_equal ['bundletool'], bundletool_command
    end
  end

  def test_bundletool_falls_back_to_the_jar
    Dir.mktmpdir do |dir|
      jar = File.join(dir, 'bundletool-all.jar')
      File.write(jar, '')
      ENV['PATH'] = File.join(dir, 'empty')
      ENV['BUNDLETOOL_JAR'] = jar
      assert_equal ['java', '-jar', jar], bundletool_command
    end
  end

  def test_bundletool_dies_with_an_install_hint_when_absent
    Dir.mktmpdir do |dir|
      ENV['PATH'] = dir
      ENV.delete('BUNDLETOOL_JAR')
      error = assert_raises(UI::UserError) { bundletool_command }
      assert_includes error.message, 'brew install bundletool'
      assert_includes error.message, 'BUNDLETOOL_JAR'
    end
  end

  # ---------- repo root anchoring ----------

  def test_paths_are_anchored_on_the_repo_root_from_either_working_directory
    # fastlane runs every lane with the working directory set to fastlane/.
    # Relative paths looked right and silently resolved to nothing there:
    # metadata_locales returned [] and release_production wrote no notes.
    Dir.mktmpdir do |tmp|
      dir = File.realpath(tmp)
      FileUtils.mkdir_p(File.join(dir, 'fastlane', 'lanes'))
      FileUtils.mkdir_p(File.join(dir, 'fastlane', 'metadata', 'ios', 'en-US'))

      Dir.chdir(File.join(dir, 'fastlane')) do
        assert_equal dir, repo_root
        assert_equal %w[en-US], metadata_locales(ios_metadata_path)
        assert_equal File.join(dir, 'artifacts', 'ios'), output_dir('ios')
      end

      Dir.chdir(dir) do
        assert_equal dir, repo_root
        assert_equal %w[en-US], metadata_locales(ios_metadata_path)
      end
    end
  end

  def test_an_explicit_output_dir_is_taken_as_given_when_absolute
    ENV['RNW_OUTPUT_DIR'] = '/tmp/rnw-out'
    assert_equal '/tmp/rnw-out', output_dir('ios')
  end

  # ---------- metadata locales, release notes, placeholder gate ----------

  def test_metadata_locales_skips_the_non_locale_directories
    Dir.mktmpdir do |dir|
      %w[en-US de fr-FR review_information screenshots changelogs].each { |d| FileUtils.mkdir_p(File.join(dir, d)) }
      File.write(File.join(dir, 'copyright.txt'), '2026')
      assert_equal %w[de en-US fr-FR], metadata_locales(dir)
    end
  end

  def test_locale_store_notes_prefers_the_per_locale_json
    ENV['STORE_NOTES_JSON'] = write_file(JSON.generate({ 'en-US' => { 'play' => 'English notes' }, 'de' => { 'play' => 'Deutsche Notizen' } }))
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file('fallback')

    assert_equal 'Deutsche Notizen', locale_store_notes('de', :play, 500)
  end

  def test_locale_store_notes_falls_back_when_the_locale_or_file_is_missing
    ENV['STORE_NOTES_JSON'] = write_file(JSON.generate({ 'en-US' => { 'play' => 'English notes' } }))
    ENV['RELEASE_NOTES_STORE_FILE'] = write_file('fallback text')

    assert_equal 'fallback text', locale_store_notes('sv-SE', :play, 500)

    ENV.delete('STORE_NOTES_JSON')
    assert_equal 'fallback text', locale_store_notes('en-US', :play, 500)
  end

  def test_locale_store_notes_truncates_to_the_store_limit
    ENV['STORE_NOTES_JSON'] = write_file(JSON.generate({ 'en-US' => { 'play' => 'a' * 900 } }))
    assert_equal 500, locale_store_notes('en-US', :play, 500).length
  end

  def test_assert_metadata_ready_names_every_file_still_holding_placeholder_text
    Dir.mktmpdir do |dir|
      FileUtils.mkdir_p(File.join(dir, 'en-US'))
      File.write(File.join(dir, 'en-US', 'description.txt'), 'Replace this text with your own.')
      File.write(File.join(dir, 'en-US', 'name.txt'), 'Real App')
      error = assert_raises(UI::UserError) { assert_metadata_ready!(dir) }
      assert_includes error.message, 'description.txt'
      refute_includes error.message, 'name.txt'
    end
  end

  def test_assert_metadata_ready_passes_once_the_placeholders_are_gone
    Dir.mktmpdir do |dir|
      FileUtils.mkdir_p(File.join(dir, 'en-US'))
      File.write(File.join(dir, 'en-US', 'description.txt'), 'A real description.')
      assert_metadata_ready!(dir)
    end
  end

  # ---------- assert_project_version! ----------

  def test_assert_project_version_accepts_matching_numbers
    ENV['APP_VERSION'] = '1.2.3'
    ENV['APP_BUILD_NUMBER'] = '42'
    assert_project_version!('1.2.3', 42)
  end

  def test_assert_project_version_rejects_a_stale_prebuild
    ENV['APP_VERSION'] = '1.2.3'
    ENV['APP_BUILD_NUMBER'] = '42'
    assert_includes assert_raises(UI::UserError) { assert_project_version!('1.2.2', '42') }.message, 'APP_VERSION'
    assert_includes assert_raises(UI::UserError) { assert_project_version!('1.2.3', '41') }.message, 'APP_BUILD_NUMBER'
  end
end

# Lane-level tests: the promotion logic itself, exercised through the recorded
# lane blocks with every fastlane action stubbed.
class LaneBehaviourTest < Minitest::Test
  ENV_DEFAULTS = {
    'APP_VERSION' => '1.2.3',
    'APP_BUILD_NUMBER' => '42',
    'IOS_BUNDLE_ID' => 'com.example.app',
    'IOS_SCHEME' => 'App',
    'ANDROID_PACKAGE' => 'com.example.app',
    'ASC_KEY_ID' => 'KEYID',
    'ASC_ISSUER_ID' => 'ISSUER',
    'ASC_KEY_P8_BASE64' => 'BASE64P8',
    'PLAY_SERVICE_ACCOUNT_JSON' => '{"type":"service_account"}',
    'TESTFLIGHT_INTERNAL_GROUP' => 'Internal',
    'TESTFLIGHT_EXTERNAL_GROUP' => 'Beta'
  }.freeze

  # Env keys a test must not inherit from the shell that ran the suite.
  CLEARED_ENV = %w[
    DRY_RUN RNW_OUTPUT_DIR STORE_NOTES_JSON PLAY_ROLLOUT PLAY_UPDATE_PRIORITY
    IOS_PHASED_RELEASE PLAY_SERVICE_ACCOUNT_JSON_PATH BUNDLETOOL_JAR CI
    APP_REVIEW_FIRST_NAME APP_REVIEW_LAST_NAME APP_REVIEW_PHONE APP_REVIEW_EMAIL
    APP_REVIEW_DEMO_USER APP_REVIEW_DEMO_PASSWORD APP_REVIEW_NOTES
    ANDROID_UPLOAD_KEYSTORE_PATH ANDROID_UPLOAD_KEYSTORE_PASSWORD
    ANDROID_UPLOAD_KEY_ALIAS ANDROID_UPLOAD_KEY_PASSWORD
    MATCH_GIT_URL MATCH_PASSWORD
  ].freeze

  def setup
    UI.reset!
    reset_calls!
    @env = ENV.to_h
    CLEARED_ENV.each { |key| ENV.delete(key) }
    ENV_DEFAULTS.each { |key, value| ENV[key] = value }
  end

  def teardown
    ENV.replace(@env)
  end

  # A throwaway checkout: the metadata tree, the artifact directory and the
  # build-info/notes files the lanes read, with the lane run inside it.
  def in_project(locales: %w[en-US], notes: nil)
    Dir.mktmpdir do |dir|
      %w[ios android].each do |platform|
        locales.each { |locale| FileUtils.mkdir_p(File.join(dir, 'fastlane', 'metadata', platform, locale)) }
      end
      FileUtils.mkdir_p(File.join(dir, 'fastlane', 'metadata', 'ios', 'review_information'))
      FileUtils.mkdir_p(File.join(dir, 'artifacts', 'ios'))
      FileUtils.mkdir_p(File.join(dir, 'artifacts', 'android'))
      FileUtils.mkdir_p(File.join(dir, 'scripts', 'release'))
      File.write(File.join(dir, 'artifacts', 'ios', 'App.ipa'), 'ipa')
      File.write(File.join(dir, 'artifacts', 'android', 'app-release.aab'), 'aab')
      File.write(File.join(dir, 'build-info.json'), JSON.generate({ 'version' => '1.2.3', 'buildNumber' => 42 }))
      File.write(File.join(dir, 'notes-store.txt'), 'Faster search and fewer crashes.')
      ENV['BUILD_INFO_FILE'] = File.join(dir, 'build-info.json')
      ENV['RELEASE_NOTES_STORE_FILE'] = File.join(dir, 'notes-store.txt')
      if notes
        File.write(File.join(dir, 'store-notes.json'), JSON.generate(notes))
        ENV['STORE_NOTES_JSON'] = File.join(dir, 'store-notes.json')
      end
      Dir.chdir(dir) { yield dir }
    end
  end

  def args_for(action)
    call = $calls.find { |name, _| name == action }
    refute_nil call, "expected a #{action} call, got #{$calls.map(&:first).inspect}"
    call.last
  end

  def called?(action)
    $calls.any? { |name, _| name == action }
  end

  # ---------- ios build ----------

  def test_ios_build_skip_signing_archives_without_signing_or_export
    in_project do |dir|
      FileUtils.mkdir_p(File.join(dir, 'ios', 'App.xcodeproj'))
      FileUtils.mkdir_p(File.join(dir, 'ios', 'App.xcworkspace'))
      run_lane(:ios, :build, skip_signing: 'true')

      args = args_for(:gym)
      assert args[:skip_codesigning], 'a local proof must not need a signing identity'
      assert args[:skip_package_ipa]
      refute args.key?(:export_method), 'export_method must be omitted or gym tries to export'
      assert_equal 'Release', args[:configuration]
      assert_equal root_path('artifacts', 'ios', 'App.xcarchive'), args[:archive_path]
      refute called?(:match), 'an unsigned proof must not touch the match repo'
    end
  end

  def test_ios_build_signs_and_exports_for_the_app_store
    in_project do |dir|
      FileUtils.mkdir_p(File.join(dir, 'ios', 'App.xcodeproj'))
      FileUtils.mkdir_p(File.join(dir, 'ios', 'App.xcworkspace'))
      ENV['MATCH_GIT_URL'] = 'git@example.com:certs.git'
      ENV['MATCH_PASSWORD'] = 'secret'
      run_lane(:ios, :build)

      assert_equal 'appstore', args_for(:match)[:type]
      assert args_for(:match)[:readonly], 'CI never creates certificates'
      args = args_for(:gym)
      assert_equal 'app-store', args[:export_method]
      assert_equal({ manageAppVersionAndBuildNumber: false }, args[:export_options])
    end
  end

  def test_ios_build_refuses_a_project_whose_numbers_do_not_match_the_release
    in_project do |dir|
      FileUtils.mkdir_p(File.join(dir, 'ios', 'App.xcodeproj'))
      FileUtils.mkdir_p(File.join(dir, 'ios', 'App.xcworkspace'))
      stub_result(:get_build_number, '41')
      error = assert_raises(UI::UserError) { run_lane(:ios, :build, skip_signing: 'true') }
      assert_includes error.message, 'APP_BUILD_NUMBER'
      refute called?(:gym), 'nothing may be archived once the numbers disagree'
    end
  end

  def test_ios_build_says_prebuild_has_not_run
    in_project do
      error = assert_raises(UI::UserError) { run_lane(:ios, :build, skip_signing: 'true') }
      assert_includes error.message, 'prebuild'
    end
  end

  # ---------- ios verify ----------

  def test_ios_verify_names_the_missing_script
    in_project do
      error = assert_raises(UI::UserError) { run_lane(:ios, :verify) }
      assert_includes error.message, 'scripts/release/verify-ios.sh'
    end
  end

  def test_ios_verify_passes_no_signing_through_to_the_script
    in_project do |dir|
      File.write(File.join(dir, 'scripts', 'release', 'verify-ios.sh'), '#!/bin/bash')
      run_lane(:ios, :verify, skip_signing: 'true')

      command = args_for(:sh)
      assert_equal 'bash', command[0]
      assert_equal root_path('scripts', 'release', 'verify-ios.sh'), command[1]
      assert_includes command, '--no-signing'
    end
  end

  # ---------- ios upload_internal ----------

  def test_ios_upload_internal_skips_when_the_build_number_already_exists
    in_project do
      stub_result(:latest_testflight_build_number, 42)
      run_lane(:ios, :upload_internal)

      refute called?(:upload_to_testflight), 'a retried job must not fail on a duplicate build'
      assert(UI.messages.any? { |m| m.include?('skipping upload') }, UI.messages.inspect)
    end
  end

  def test_ios_upload_internal_uploads_a_new_build_number
    in_project do
      stub_result(:latest_testflight_build_number, 41)
      run_lane(:ios, :upload_internal)

      args = args_for(:upload_to_testflight)
      assert_equal root_path('artifacts', 'ios', 'App.ipa'), args[:ipa]
      assert_equal 'Faster search and fewer crashes.', args[:changelog]
      assert_equal ['Internal'], args[:groups]
      refute args[:distribute_external], 'internal uploads never go to external testers'
      assert args[:skip_submission]
    end
  end

  def test_ios_upload_internal_refuses_an_artifact_from_another_release
    in_project do |dir|
      File.write(File.join(dir, 'build-info.json'), JSON.generate({ 'version' => '9.9.9', 'buildNumber' => 42 }))
      assert_raises(UI::UserError) { run_lane(:ios, :upload_internal) }
      refute called?(:upload_to_testflight)
    end
  end

  # ---------- ios promote_beta ----------

  def test_ios_promote_beta_distributes_the_existing_build_without_re_uploading
    in_project do
      run_lane(:ios, :promote_beta)

      args = args_for(:upload_to_testflight)
      assert args[:distribute_only], 'beta must ship the exact binary internal testers saw'
      assert args[:distribute_external]
      assert_equal ['Beta'], args[:groups]
      assert_equal '42', args[:build_number]
      refute args.key?(:ipa), 'distribute_only must not carry an artifact'
    end
  end

  def test_ios_promote_beta_sends_review_contact_details_in_pilots_key_names
    in_project do
      ENV['APP_REVIEW_EMAIL'] = 'review@example.com'
      ENV['APP_REVIEW_DEMO_USER'] = 'demo'
      run_lane(:ios, :promote_beta)

      info = args_for(:upload_to_testflight)[:beta_app_review_info]
      assert_equal 'review@example.com', info[:contact_email]
      assert_equal 'demo', info[:demo_account_name]
      assert info[:demo_account_required]
    end
  end

  # ---------- ios release_production ----------

  def test_ios_release_production_writes_release_notes_per_locale_directory
    notes = {
      'en-US' => { 'appstore' => 'English App Store notes.' },
      'de' => { 'appstore' => 'Deutsche App-Store-Notizen.' }
    }
    in_project(locales: %w[en-US de], notes: notes) do
      run_lane(:ios, :release_production)

      assert_equal "English App Store notes.\n", File.read('fastlane/metadata/ios/en-US/release_notes.txt')
      assert_equal "Deutsche App-Store-Notizen.\n", File.read('fastlane/metadata/ios/de/release_notes.txt')
      refute File.exist?('fastlane/metadata/ios/review_information/release_notes.txt'),
             'review_information is not a locale'
    end
  end

  def test_ios_release_production_submits_metadata_only
    in_project do
      ENV['IOS_PHASED_RELEASE'] = 'true'
      run_lane(:ios, :release_production)

      args = args_for(:upload_to_app_store)
      assert args[:skip_binary_upload], 'the binary is already in App Store Connect'
      assert_equal root_path('fastlane', 'metadata', 'ios'), args[:metadata_path]
      assert args[:submit_for_review]
      assert args[:automatic_release]
      assert args[:phased_release]
      refute args[:run_precheck_before_submit]
      assert_equal({}, args[:app_review_information].reject { |_, v| v.to_s.empty? })
    end
  end

  def test_ios_release_production_refuses_placeholder_metadata
    in_project do
      File.write('fastlane/metadata/ios/en-US/description.txt', 'Replace this text with the story of your own app.')
      error = assert_raises(UI::UserError) { run_lane(:ios, :release_production) }
      assert_includes error.message, 'description.txt'
      refute called?(:upload_to_app_store)
    end
  end

  # ---------- ios phased ----------

  def test_ios_phased_drives_the_live_versions_phased_release
    in_project do
      run_lane(:ios, :phased, action: 'pause')
      assert_equal [[:phased_release, { action: 'pause' }]], $calls.select { |name, _| name == :phased_release }
    end
  end

  def test_ios_phased_rejects_an_unknown_action
    in_project do
      error = assert_raises(UI::UserError) { run_lane(:ios, :phased, action: 'stop') }
      assert_includes error.message, 'pause|resume|complete'
    end
  end

  # ---------- android upload_internal ----------

  def test_android_upload_internal_skips_a_version_code_the_track_already_has
    in_project do
      stub_result(:google_play_track_version_codes, [41, 42])
      run_lane(:android, :upload_internal)

      refute called?(:upload_to_play_store), 'Play rejects a duplicate version code'
      assert(UI.messages.any? { |m| m.include?('skipping upload') }, UI.messages.inspect)
    end
  end

  def test_android_upload_internal_writes_the_changelog_supply_reads
    in_project(notes: { 'en-US' => { 'play' => 'Kortare notes.' } }) do
      stub_result(:google_play_track_version_codes, [41])
      run_lane(:android, :upload_internal)

      assert_equal "Kortare notes.\n", File.read('fastlane/metadata/android/en-US/changelogs/42.txt')
      args = args_for(:upload_to_play_store)
      assert_equal 'internal', args[:track]
      assert_equal 42, args[:version_code]
      assert_equal root_path('artifacts', 'android', 'app-release.aab'), args[:aab]
      assert args[:skip_upload_metadata], 'the public listing is synced only from release_production'
      refute args[:skip_upload_changelogs]
      assert_equal '{"type":"service_account"}', args[:json_key_data]
    end
  end

  # ---------- android promote_beta / release_production ----------

  def test_android_promote_beta_promotes_without_uploading
    in_project do
      run_lane(:android, :promote_beta)

      args = args_for(:upload_to_play_store)
      assert_equal 'internal', args[:track]
      assert_equal 'beta', args[:track_promote_to]
      assert_equal 'completed', args[:track_promote_release_status]
      assert args[:skip_upload_aab]
    end
  end

  def test_android_release_production_promotes_at_the_configured_rollout
    in_project do
      ENV['PLAY_ROLLOUT'] = '0.2'
      ENV['PLAY_UPDATE_PRIORITY'] = '3'
      run_lane(:android, :release_production)

      args = args_for(:upload_to_play_store)
      assert_equal 'beta', args[:track]
      assert_equal 'production', args[:track_promote_to]
      assert_in_delta 0.2, args[:rollout]
      assert_equal 3, args[:in_app_update_priority]
      refute args[:skip_upload_metadata], 'production is the one lane that syncs the listing'
      refute args[:skip_upload_images]
    end
  end

  def test_android_release_production_defaults_to_a_full_rollout
    in_project do
      run_lane(:android, :release_production)
      assert_in_delta 1.0, args_for(:upload_to_play_store)[:rollout]
    end
  end

  # ---------- android rollout ----------

  def test_android_rollout_updates_the_fraction_without_uploading
    in_project do
      run_lane(:android, :rollout, percent: 50)

      args = args_for(:upload_to_play_store)
      assert_in_delta 0.5, args[:rollout]
      assert args[:skip_upload_aab], 'update_rollout is the path with nothing to upload'
      assert args[:skip_upload_apk]
      assert_equal 'production', args[:track]
    end
  end

  # ---------- android halt ----------

  def test_android_halt_sets_the_release_status_through_supply
    in_project do
      run_lane(:android, :halt)

      assert_equal 'halted', args_for(:upload_to_play_store)[:release_status]
      refute called?(:supply_client), 'the fallback is only for when supply fails'
    end
  end

  def test_android_halt_falls_back_to_the_android_publisher_api
    in_project do
      # fastlane #21253/#21431: `release_status: halted` through supply has
      # regressed before, and halting cannot wait for an upstream fix.
      original = Object.instance_method(:upload_to_play_store)
      Object.send(:define_method, :upload_to_play_store) do |**args|
        $calls << [:upload_to_play_store, args]
        raise 'Google Api Error: releases[0].status'
      end
      begin
        run_lane(:android, :halt)
      ensure
        Object.send(:define_method, :upload_to_play_store, original)
      end

      assert called?(:supply_client), 'the direct AndroidPublisher edit must run'
      assert_equal ['halted'], args_for(:supply_update_track)[:statuses]
      assert called?(:supply_commit), 'an uncommitted edit changes nothing'
    end
  end

  def test_android_halt_fallback_refuses_a_version_code_it_cannot_find
    in_project do
      stub_result(:supply_tracks, [Supply::Track.new([Supply::Release.new([7])])])
      original = Object.instance_method(:upload_to_play_store)
      Object.send(:define_method, :upload_to_play_store) { |**_args| raise 'boom' }
      begin
        error = assert_raises(UI::UserError) { run_lane(:android, :halt) }
        assert_includes error.message, '42'
      ensure
        Object.send(:define_method, :upload_to_play_store, original)
      end
    end
  end

  # ---------- android build helpers ----------

  def test_android_signing_properties_carry_the_names_the_config_plugin_reads
    ENV['ANDROID_UPLOAD_KEYSTORE_PATH'] = 'keys/upload.jks'
    ENV['ANDROID_UPLOAD_KEYSTORE_PASSWORD'] = 'store'
    ENV['ANDROID_UPLOAD_KEY_ALIAS'] = 'upload'
    ENV['ANDROID_UPLOAD_KEY_PASSWORD'] = 'key'

    props = android_signing_properties
    # These four names are read by plugins/with-android-release-signing.ts.
    assert_equal %w[ANDROID_UPLOAD_KEY_ALIAS ANDROID_UPLOAD_KEY_PASSWORD ANDROID_UPLOAD_STORE_FILE ANDROID_UPLOAD_STORE_PASSWORD],
                 props.keys.sort
    assert_equal root_path('keys/upload.jks'), props['ANDROID_UPLOAD_STORE_FILE'],
                 'gradle resolves storeFile relative to android/app'
  end

  def test_android_build_refuses_to_run_without_the_upload_keystore
    in_project do
      error = assert_raises(UI::UserError) { run_lane(:android, :build) }
      assert_includes error.message, 'ANDROID_UPLOAD_KEYSTORE_PATH'
      refute called?(:gradle)
    end
  end

  # ---------- future stores ----------

  def test_the_future_store_lanes_point_at_the_runbook
    %i[upload_huawei upload_samsung fdroid_metadata].each do |lane_name|
      error = assert_raises(UI::UserError) { run_lane(nil, lane_name) }
      assert_includes error.message, 'docs/release-runbook.md#future-stores'
    end
  end
end
