# Homebrew Bundle v6 Compatibility Design

## Problem

The Darwin package template trims the newline between the shell heredoc opener
and the first rendered tap. The resulting command is equivalent to:

```bash
brew bundle --file=/dev/stdin --cleanup --force <<EOFtap "modem-dev/tap"
```

Bash therefore passes the tap name to Homebrew as a positional argument, and
Homebrew reports it as an unknown subcommand. Homebrew 6 also deprecates the
legacy `--cleanup` install switch.

## Contract

The rendered Darwin installer must:

- be syntactically valid according to `bash -n`;
- pass the Brewfile through a correctly delimited stdin heredoc; and
- synchronize declared packages authoritatively with Homebrew 6's supported
  `brew bundle install --file=/dev/stdin --force-cleanup` interface.

The package manifest schema and strict cleanup semantics remain unchanged.

## Implementation

Retain the existing inline Brewfile, but prevent Go-template whitespace
trimming from consuming the newline after `<<EOF`. Replace the deprecated
legacy invocation with the explicit `install --force-cleanup` form. This is
simpler than writing a temporary Brewfile or performing separate install and
cleanup commands, while allowing Homebrew to parse the Brewfile once and reuse
it for cleanup.

## Verification

Extend `tests/darwin-install-packages-template.test.sh` to execute `bash -n` on
the rendered default script. This deterministic test exercises the actual
rendered shell artifact and catches malformed heredoc delimiters. Existing
manifest rendering assertions continue to verify blocked and unblocked package
selection.
