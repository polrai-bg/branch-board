#!/bin/sh
# Fail when a pull request does not link an issue.
# A link is a closing keyword in the title or body (Closes #123, Fixes owner/repo#123,
# or Resolves https://github.com/owner/repo/issues/123), or a head branch matching
# ^(?:[^/]+/)?[0-9]+-   which is the issuePattern ^(?:[^/]+/)?(\d+)-
# A head branch that starts with a prefix from an exempt-prefixes file passes.
#
# Env: HEAD_REF, PR_TITLE, PR_BODY
# Prefix file, first found: .github/exempt-prefixes, .githooks/exempt-prefixes, workflow/exempt-prefixes

set -eu

head=${HEAD_REF:-}
title=${PR_TITLE:-}
body=${PR_BODY:-}

if [ -z "$head" ]; then
  echo "require-issue: HEAD_REF is empty" >&2
  exit 1
fi

root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

exempt_file=""
for candidate in \
  "$root/.github/exempt-prefixes" \
  "$root/.githooks/exempt-prefixes" \
  "$root/workflow/exempt-prefixes"
do
  if [ -f "$candidate" ]; then
    exempt_file=$candidate
    break
  fi
done

if [ -n "$exempt_file" ]; then
  while IFS= read -r prefix || [ -n "$prefix" ]; do
    prefix=$(printf '%s' "$prefix" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    case "$prefix" in
      ""|\#*) continue ;;
    esac
    case "$head" in
      "$prefix"*)
        echo "require-issue: exempt ($prefix)"
        exit 0
        ;;
    esac
  done < "$exempt_file"
fi

if printf '%s\n' "$head" | grep -Eq '^(?:[^/]+/)?[0-9]+-'; then
  echo "require-issue: branch name links an issue"
  exit 0
fi

blob=$(printf '%s\n%s\n' "$title" "$body")
if printf '%s\n' "$blob" | grep -Eiq '(^|[^[:alnum:]_])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[[:space:]]+(#[0-9]+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[0-9]+|https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[0-9]+)'; then
  echo "require-issue: closing keyword links an issue"
  exit 0
fi

echo "require-issue: pull request does not link an issue" >&2
echo "require-issue: use a closing keyword such as 'Closes #<issue>', or name the branch <prefix>/<issue>-<slug>" >&2
echo "require-issue: exempt prefixes are listed in .github/exempt-prefixes" >&2
exit 1
