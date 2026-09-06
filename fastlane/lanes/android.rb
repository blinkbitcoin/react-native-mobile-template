# Android lanes (bundle, internal track, staged production rollout).
#
# Skeleton only: the lanes land in a later task of this phase. Everything that
# uploads or promotes must go through `store_action` from shared.rb so DRY_RUN=1
# stays a full rehearsal.
#
# Play metadata lives in fastlane/metadata/android/, which is supply's default.
platform :android do
end
