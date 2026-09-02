# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- `wave webhook-subscriptions list|create` — manage the platform's own event-subscription
  surface, distinct from `wave connect` third-party webhooks (#37).
- `wave identity resolve <identifier>` — resolve an agent identity through the fleet directory
  (#37).

## [1.0.8] - 2026-08-04
### Changed
- License changed to Apache-2.0, replacing MIT. Adds a NOTICE reserving the WAVE trademarks. No
  code or API changes (#5).
- Repository history now contains the source for this version, rebuilt byte-identically from the
  sourcemaps shipped in the published npm tarball (#18). Versions 1.0.1 through 1.0.7 were
  published to the npm registry between 2026-04-02 and 2026-04-03 but were never committed to
  this repository, so they have no individually dated section here; their recovered source
  landed in this same commit.

## [1.0.0] - 2026-04-05
### Added
- Initial public repository: README, LICENSE (MIT at the time), SECURITY.md.
### Fixed
- Corrected legal entity name to WAVE Online, LLC.

[Unreleased]: https://github.com/wave-av/cli/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wave-av/cli/releases/tag/v1.0.0
