# Enough of fastlane to load fastlane/lanes/*.rb without fastlane running.
#
# shared.rb is deliberately written against `UI` and plain Ruby only, and the
# lane files use nothing but the `platform`/`lane`/`desc` DSL plus fastlane
# actions -- so the helpers and the promotion logic that decide what gets
# uploaded can be unit-tested in milliseconds instead of being discovered
# during a release.
require 'json'

# Records every stubbed fastlane action call as [name, args].
$calls = []

# Per-test overrides for what a stubbed action returns, so a test can say
# "TestFlight already has build 42" without redefining the stub.
$stub_results = {}

module UI
  class UserError < StandardError; end

  # fastlane's UI.user_error! aborts the lane; here it just raises.
  def self.user_error!(message)
    raise UserError, message
  end

  def self.important(message)
    messages << message
  end

  def self.message(message)
    messages << message
  end

  def self.success(message)
    messages << message
  end

  def self.messages
    @messages ||= []
  end

  def self.reset!
    messages.clear
  end
end

# Clears the action recorder. Kept separate from UI.reset! so the stubbed UI
# does not own a global it has nothing to do with.
def reset_calls!
  $calls.clear
  $stub_results.clear
end

def stub_result(action, value)
  $stub_results[action] = value
end

# The fastlane actions the lanes reach for. Each records its call and returns
# something shaped like the real return value.
{
  upload_to_testflight: nil,
  upload_to_play_store: nil,
  upload_to_app_store: nil,
  gym: '/tmp/App.ipa',
  gradle: '/tmp/app-release.aab',
  match: nil,
  setup_ci: nil,
  app_store_connect_api_key: { key_id: 'STUB' },
  google_play_track_version_codes: [1],
  latest_testflight_build_number: 0,
  get_version_number: '1.2.3',
  get_build_number: '42',
  download_dsyms: nil
}.each do |action, result|
  Object.send(:define_method, action) do |**args|
    $calls << [action, args]
    $stub_results.fetch(action) { result }
  end
end

# fastlane's `sh` takes argv plus keyword options (`log:` suppresses the echo
# of a command line that carries a keystore password).
def sh(*command, **options)
  $calls << [:sh, command]
  options
  ''
end

# ---------------------------------------------------------------------------
# The lane DSL
# ---------------------------------------------------------------------------
#
# Loading a lane file records its blocks instead of running them; `run_lane`
# then invokes one with the stubs above in place. This is the only way to test
# the promotion logic itself -- the part that decides `distribute_only`,
# whether to skip an upload, or which fallback to take.

$lanes = {}
$current_platform = nil

def platform(name)
  previous = $current_platform
  $current_platform = name
  yield
ensure
  $current_platform = previous
end

def lane(name, &block)
  ($lanes[$current_platform] ||= {})[name] = block
end

def private_lane(name, &block)
  lane(name, &block)
end

def desc(_text); end

def run_lane(platform_name, lane_name, options = {})
  block = $lanes.fetch(platform_name) { raise "no lanes for platform #{platform_name.inspect}" }
                .fetch(lane_name) { raise "no lane #{lane_name.inspect} on #{platform_name.inspect}" }
  block.call(options)
end

# ---------------------------------------------------------------------------
# Spaceship (iOS `phased`) and supply (Android `halt` fallback)
# ---------------------------------------------------------------------------

module Spaceship
  class ConnectAPI
    class PhasedRelease
      def pause
        $calls << [:phased_release, { action: 'pause' }]
      end

      def resume
        $calls << [:phased_release, { action: 'resume' }]
      end

      def complete
        $calls << [:phased_release, { action: 'complete' }]
      end
    end

    class AppStoreVersion
      def fetch_app_store_version_phased_release
        $stub_results.fetch(:phased_release) { PhasedRelease.new }
      end
    end

    class App
      def self.find(bundle_id)
        $calls << [:spaceship_app_find, { bundle_id: bundle_id }]
        $stub_results.fetch(:spaceship_app) { new }
      end

      def get_live_app_store_version
        $stub_results.fetch(:live_app_store_version) { AppStoreVersion.new }
      end
    end
  end
end

module FastlaneCore
  module Configuration
    def self.create(_options, values)
      values
    end
  end
end

# A supply double. `halt_via_android_publisher!` only requires the real gem when
# `Supply` is undefined, so defining it here keeps the fallback test offline.
module Supply
  module Tracks
    PRODUCTION = 'production'.freeze
  end

  module ReleaseStatus
    HALTED = 'halted'.freeze
  end

  module Options
    def self.available_options
      []
    end
  end

  class << self
    attr_accessor :config
  end

  class Release
    attr_reader :version_codes
    attr_accessor :status

    def initialize(version_codes, status = 'inProgress')
      @version_codes = version_codes
      @status = status
    end
  end

  class Track
    attr_reader :releases

    def initialize(releases)
      @releases = releases
    end
  end

  class Client
    def self.make_from_config
      $calls << [:supply_client, {}]
      new
    end

    def begin_edit(package_name:)
      $calls << [:supply_begin_edit, { package_name: package_name }]
    end

    def tracks(*names)
      $calls << [:supply_tracks, { names: names }]
      $stub_results.fetch(:supply_tracks) { [Track.new([Release.new([42])])] }
    end

    def update_track(name, track)
      $calls << [:supply_update_track, { name: name, statuses: track.releases.map(&:status) }]
    end

    def commit_current_edit!
      $calls << [:supply_commit, {}]
    end
  end
end
