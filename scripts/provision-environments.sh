#!/usr/bin/env bash
#
# Provision the `production` GitHub Environment's deploy-governance rules for issue #89.
#
# Why this exists: Environment protection rules (required reviewers, deployment branch/tag
# policies) live in repo Settings, NOT in deploy.yml — the workflow only *references* the
# environment by name. Clicking them in the UI is invisible to review and easy to drift. This
# script codifies them so the production approval gate is reproducible and auditable.
#
# It is idempotent: re-running re-applies the same rules. Safe to run after any maintainer change.
#
# What it configures on the `production` environment:
#   1. Required reviewers (+ prevent self-review) — a human must click "Review deployments"
#      before a prod deploy reaches a runner (so before Cloudflare auth ever runs).
#   2. A deployment TAG policy `v*` — GitHub itself refuses to deploy `production` unless the ref
#      is a release tag, even if deploy.yml's `detect` logic were wrong (defense in depth).
#
# Prerequisites:
#   - gh CLI authenticated with admin rights on the repo (`gh auth status`).
#   - Reviewers passed as env vars (at least one required):
#       REVIEWER_USERS="alice,bob"      # GitHub logins
#       REVIEWER_TEAMS="midt-bg/maintainers"   # org/team-slug (optional)
#
# Usage:
#   REVIEWER_USERS="lyubomir-bozhinov" ./scripts/provision-environments.sh
#   REVIEWER_TEAMS="midt-bg/maintainers" ./scripts/provision-environments.sh
#
set -euo pipefail

REPO="${REPO:-midt-bg/sigma}"
ENVIRONMENT="production"
REVIEWER_USERS="${REVIEWER_USERS:-}"
REVIEWER_TEAMS="${REVIEWER_TEAMS:-}"

if [ -z "$REVIEWER_USERS" ] && [ -z "$REVIEWER_TEAMS" ]; then
  echo "❌ No reviewers given. Set REVIEWER_USERS and/or REVIEWER_TEAMS." >&2
  echo "   Example: REVIEWER_USERS=\"lyubomir-bozhinov\" $0" >&2
  exit 1
fi

command -v gh >/dev/null 2>&1 || { echo "❌ gh CLI not found. Install it or run from a machine with it." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "❌ jq not found. Install it (used to resolve reviewer ids)." >&2; exit 1; }

# Build the reviewers[] array as JSON: resolve each login/team-slug to its numeric id, which the
# environments API requires (it rejects names).
reviewers_json="[]"

add_reviewer() {  # $1=type (User|Team)  $2=id
  reviewers_json="$(jq -c --arg t "$1" --argjson id "$2" '. += [{"type":$t,"id":$id}]' <<<"$reviewers_json")"
}

if [ -n "$REVIEWER_USERS" ]; then
  IFS=',' read -ra users <<<"$REVIEWER_USERS"
  for u in "${users[@]}"; do
    u="$(echo "$u" | xargs)"  # trim whitespace
    [ -z "$u" ] && continue
    id="$(gh api "users/$u" --jq .id)" || { echo "❌ Could not resolve user '$u'." >&2; exit 1; }
    echo "  reviewer (user):  $u → $id"
    add_reviewer "User" "$id"
  done
fi

if [ -n "$REVIEWER_TEAMS" ]; then
  IFS=',' read -ra teams <<<"$REVIEWER_TEAMS"
  for t in "${teams[@]}"; do
    t="$(echo "$t" | xargs)"
    [ -z "$t" ] && continue
    org="${t%%/*}"; slug="${t##*/}"
    id="$(gh api "orgs/$org/teams/$slug" --jq .id)" || { echo "❌ Could not resolve team '$t'." >&2; exit 1; }
    echo "  reviewer (team):  $t → $id"
    add_reviewer "Team" "$id"
  done
fi

echo "→ Applying required reviewers + tag policy to '$ENVIRONMENT' on $REPO …"

# 1. Required reviewers, prevent self-review, and enable custom branch/tag policies in one PUT.
gh api -X PUT "repos/$REPO/environments/$ENVIRONMENT" --input - >/dev/null <<JSON
{
  "prevent_self_review": true,
  "reviewers": $reviewers_json,
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
JSON
echo "  ✅ required reviewers set (prevent_self_review=true)"

# 2. Add the v* TAG policy (type=tag — a tag rule, never matched by a branch named v…).
#    Skip silently if an identical policy already exists (idempotent re-runs).
existing="$(gh api "repos/$REPO/environments/$ENVIRONMENT/deployment-branch-policies" --jq '.branch_policies[]?.name' 2>/dev/null || true)"
if echo "$existing" | grep -qx 'v\*'; then
  echo "  ✅ tag policy 'v*' already present"
else
  gh api -X POST "repos/$REPO/environments/$ENVIRONMENT/deployment-branch-policies" \
    -f "name=v*" -f "type=tag" >/dev/null
  echo "  ✅ tag policy 'v*' added (only release tags may deploy to production)"
fi

echo "✅ Done. Verify in: Settings → Environments → $ENVIRONMENT"
