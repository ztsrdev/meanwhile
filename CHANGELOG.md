# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

### Added

- Claude Code plugin hooks for prompt submission, stop, input-needed notifications, and session end.
- Codex CLI hooks for prompt submission, turn end, permission requests, and session end.
- A cancellable 20-second lesson handoff with automatic pull-back.
- Atomic multi-session state with `all-idle` and `any-finishes` policies.
- macOS-first configuration, installation, diagnostics, and clean uninstall commands.
