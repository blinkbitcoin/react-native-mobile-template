# Stores this template does not ship yet.
#
# The lanes exist so the shape of the pipeline is visible and so a workflow that
# calls one gets a pointer to the runbook instead of "Could not find lane".
# Each is a named slot, not a stub to be quietly filled in: adding a store means
# credentials, metadata and a verification gate, all of which the runbook lists.
FUTURE_STORES_DOC = 'Not implemented: see docs/release-runbook.md#future-stores'.freeze

desc 'Upload to Huawei AppGallery (not implemented)'
lane :upload_huawei do
  UI.user_error!(FUTURE_STORES_DOC)
end

desc 'Upload to Samsung Galaxy Store (not implemented)'
lane :upload_samsung do
  UI.user_error!(FUTURE_STORES_DOC)
end

desc 'Generate F-Droid metadata (not implemented)'
lane :fdroid_metadata do
  UI.user_error!(FUTURE_STORES_DOC)
end
