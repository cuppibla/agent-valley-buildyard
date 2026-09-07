#!/usr/bin/env bash
# The Buildyard — make a fresh billing-linked Google Cloud project for week two.
#
# Run this FIRST, before ./setup_codelab.sh. It leaves you with:
#   • a project that exists, is billing-linked, and is old enough to serve
#   • that project ID in ~/project_id.txt
#   • that project set as gcloud's active project
#
# A NEW PROJECT IS THE DEFAULT. Week two starts clean even when you already
# have a project sitting in ~/project_id.txt or in your project list. That file
# is the single thing every earlier lab writes to, so whatever is in it is as
# likely to belong to some other codelab as to week one — reusing it silently
# drops week two's resources into a stranger's project, and the script cannot
# ask you which one you meant. Making a project is cheap and unambiguous, so
# that is what happens unless you say otherwise.
#
# Set AGENT_VALLEY_REUSE_PROJECT=1 to reuse instead: the script then takes the
# project in ~/project_id.txt, or scans for one shaped like week one's
# agent-valley-NNNN, and only creates something if neither turns up.
#
# NOT safe to re-run blind: a second plain run makes a second project. Re-run
# with AGENT_VALLEY_REUSE_PROJECT=1 to pick up where the last one left off —
# every error message below tells you this too.
#
# It never prompts. Every failure exits non-zero with a fix to try.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_FILE="$HOME/project_id.txt"
PREFIX="agent-valley-"
# Week one's ./setup_project.sh creates "${PREFIX}NNNN" — four digits, from
# printf '%04d'. That shape is the fingerprint we hunt for below.
WEEK_ONE_PATTERN="^${PREFIX}[0-9]{4}$"
SCAN_LIMIT=10          # billing probes to spend while hunting; one API call each
CREATE_ATTEMPTS=3      # fresh random ID per attempt; IDs are globally unique
READY_TIMEOUT=120      # seconds to wait for a new project to be serveable
READY_INTERVAL=10      # seconds between readiness probes

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
tick() { printf '  ✓ %s\n' "$1"; }
info() { printf '  · %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1" >&2; }

# Print a block of guidance and stop. Never waits for input: this script has
# to survive being run non-interactively.
die() {
    printf '\n\033[1m✗ %s\033[0m\n\n' "$1" >&2
    shift
    for line in "$@"; do printf '%s\n' "$line" >&2; done
    printf '\n' >&2
    exit 1
}

say "Agent Valley · week two · project + billing"

# ── 0 · gcloud has to be here ─────────────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || die \
    "gcloud not found." \
    "This script is written for Cloud Shell, where gcloud is preinstalled." \
    "On a laptop, install the Google Cloud SDK first:" \
    "  https://cloud.google.com/sdk/docs/install"

if [ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]; then
    die "No active gcloud account." \
        "Authenticate, then re-run this script:" \
        "  gcloud auth login"
fi

# ── 1 · reuse, but only when you ask for it ────────────────────────────────────
# This whole section is skipped unless AGENT_VALLEY_REUSE_PROJECT is set.
# When it is, two places to look, cheapest first:
#   a. ~/project_id.txt — written by week one, and by every run of this script.
#      A hiccup halfway through should not cost you a second project.
#   b. your project list, for anything shaped like week one's agent-valley-NNNN.
#      People clear their Cloud Shell home directory between sessions far more
#      often than they delete projects, so (b) is not a rare path.
# A project only counts as reusable if billing is still on it; a credit that
# expired between weeks would otherwise fail much later, inside a Gemini call.
project_exists() {
    gcloud projects describe "$1" --format='value(projectId)' >/dev/null 2>&1
}

project_has_billing() {
    [ "$(gcloud billing projects describe "$1" \
            --format='value(billingEnabled)' 2>/dev/null)" = "True" ]
}

looks_like_week_one() {
    printf '%s\n' "$1" | grep -qE "$WEEK_ONE_PATTERN"
}

# Echo the first reusable week-one project, or nothing. Stays silent otherwise:
# the caller owns the output, and this runs inside a command substitution.
#
# No server-side name filter on purpose — filter syntax that quietly matches
# nothing would send us straight into creating a duplicate project, which is
# the one outcome this whole section exists to prevent. Listing and grepping
# locally is impossible to get subtly wrong. sort -r only makes the choice
# stable across re-runs; any of the matches would do.
find_week_one_project() {
    local all matches candidate probes=0
    all="$(gcloud projects list --filter='lifecycleState:ACTIVE' \
            --format='value(projectId)' 2>/dev/null || true)"
    [ -n "$all" ] || return 1

    matches="$(printf '%s\n' "$all" | grep -E "$WEEK_ONE_PATTERN" | sort -r || true)"
    [ -n "$matches" ] || return 1

    while IFS= read -r candidate; do
        [ -n "$candidate" ] || continue
        probes=$(( probes + 1 ))
        [ "$probes" -le "$SCAN_LIMIT" ] || break
        if project_has_billing "$candidate"; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done <<< "$matches"
    return 1
}

REUSE=""            # a project we can use exactly as it is
REUSE_SOURCE=""     # "file" or "scan" — decides what we can honestly claim

# Set when a recorded project is real but never got its billing linked — a
# half-built project from an interrupted run. That one is worth rescuing, so
# section 3 adopts it and section 4 links billing to it, instead of walking
# away and leaving you with two empty projects.
ADOPT_PROJECT=""

# AGENT_VALLEY_NEW_PROJECT used to be the opt-in for this behaviour, and week
# two's own output told people to set it. It is now what happens anyway, so
# accept it without complaining rather than erroring at someone who followed
# an older printout.
if [ -n "${AGENT_VALLEY_NEW_PROJECT:-}" ] && [ -z "${AGENT_VALLEY_REUSE_PROJECT:-}" ]; then
    info "AGENT_VALLEY_NEW_PROJECT is set — that is the default now, nothing to do"
fi

if [ -z "${AGENT_VALLEY_REUSE_PROJECT:-}" ]; then
    info "making a new project — set AGENT_VALLEY_REUSE_PROJECT=1 to reuse an existing one instead"
    if [ -f "$PROJECT_FILE" ]; then
        PREVIOUS="$(tr -d '[:space:]' < "$PROJECT_FILE" || true)"
        # Name it. Otherwise the next section quietly overwrites the file and
        # the project it pointed at becomes unfindable to anyone who did not
        # already know its ID.
        [ -n "$PREVIOUS" ] && info "$PROJECT_FILE currently says $PREVIOUS — leaving that project alone, not reusing it"
    fi
else
    info "AGENT_VALLEY_REUSE_PROJECT is set — looking for a project to reuse"
    if [ -f "$PROJECT_FILE" ]; then
        EXISTING="$(tr -d '[:space:]' < "$PROJECT_FILE" || true)"
        if [ -n "$EXISTING" ]; then
            info "Found $PROJECT_FILE → $EXISTING"
            if project_exists "$EXISTING"; then
                if project_has_billing "$EXISTING"; then
                    REUSE="$EXISTING"
                    REUSE_SOURCE="file"
                else
                    ADOPT_PROJECT="$EXISTING"
                    info "$EXISTING exists but has no billing — linking billing to it"
                fi
            else
                warn "$EXISTING is gone — looking for another Agent Valley project."
            fi
        fi
    fi

    if [ -z "$REUSE" ] && [ -z "$ADOPT_PROJECT" ]; then
        info "looking for an Agent Valley project from week one"
        REUSE="$(find_week_one_project || true)"
        if [ -n "$REUSE" ]; then
            REUSE_SOURCE="scan"
        else
            info "none found — this looks like your first Agent Valley project"
        fi
    fi
fi

if [ -n "$REUSE" ]; then
    gcloud config set project "$REUSE" >/dev/null 2>&1 \
        || warn "could not select $REUSE — run: gcloud config set project $REUSE"
    # Re-record it even when it came out of the file: a project found by the
    # scan has to land there too, or the next run pays for the scan again.
    printf '%s\n' "$REUSE" > "$PROJECT_FILE"
    # Say where it came from, not just that it is being reused: "week one" is
    # a claim we can only make about a project the scan found sitting in your
    # account. One recorded in the file may equally be from an earlier run of
    # this script, so that line says so instead of guessing.
    if [ "$REUSE_SOURCE" = "scan" ]; then
        tick "reusing $REUSE — your Agent Valley project from week one, billing still linked"
    elif looks_like_week_one "$REUSE"; then
        tick "reusing $REUSE — the Agent Valley project in $PROJECT_FILE (week one's, or an earlier run's), billing still linked"
    else
        tick "reusing $REUSE (exists, billing linked)"
    fi
    info "no new project created, because you asked for reuse; drop AGENT_VALLEY_REUSE_PROJECT for a fresh one"
    say "Project ready: $REUSE"
    printf '  Next:  ./setup_codelab.sh\n\n'
    exit 0
fi

# ── 2 · pick a billing account ────────────────────────────────────────────────
# One listing, filtered in bash. Preference order:
#   1. newest "[YYYY-MM-DD] GDP Credit: ..." account, if you have one
#   2. any open billing account (a personal card is perfectly fine)
# ISO dates sort correctly as plain strings, so `sort -r` picks the newest
# without any date parsing.
say "1 · Billing account"

BILLING_LIST="$(gcloud billing accounts list \
    --filter="open=true" \
    --format="value(displayName,name)" 2>/dev/null || true)"

if [ -z "$BILLING_LIST" ]; then
    die "No open billing account on this Google account." \
        "This lab calls Gemini on Vertex AI, which needs billing enabled." \
        "" \
        "If you were given a Google Cloud credit for this session, claim it" \
        "first — it takes about a minute and creates the billing account for" \
        "you. Then re-run:" \
        "" \
        "  ./setup_project.sh" \
        "" \
        "No credit? Any Google Cloud account with billing works, including" \
        "the free trial:" \
        "  https://console.cloud.google.com/freetrial" \
        "" \
        "Did week one on a different Google account? Sign gcloud back into" \
        "that one and this script will find last week's project:" \
        "  gcloud auth login" \
        "  gcloud auth list"
fi

# "[2026-08-14] GDP Credit: 1234" — newest first.
GDP_LINE="$(printf '%s\n' "$BILLING_LIST" \
    | grep -iE '^\[[0-9]{4}-[0-9]{2}-[0-9]{2}\][[:space:]]*GDP[[:space:]]+Credit:' \
    | sort -r | head -1 || true)"

if [ -n "$GDP_LINE" ]; then
    ACCOUNT_LINE="$GDP_LINE"
    info "using the newest GDP Credit account"
else
    ACCOUNT_LINE="$(printf '%s\n' "$BILLING_LIST" | head -1)"
    info "no GDP Credit account found — using your open billing account"
fi

# `value(a,b)` joins fields with a tab; take the last field as the resource
# name, and strip the billingAccounts/ prefix if gcloud included it.
ACCOUNT_NAME="${ACCOUNT_LINE##*$'\t'}"
ACCOUNT_ID="${ACCOUNT_NAME#billingAccounts/}"
ACCOUNT_DISPLAY="${ACCOUNT_LINE%%$'\t'*}"

if [ -z "$ACCOUNT_ID" ]; then
    die "Could not read a billing account ID out of gcloud's output." \
        "Run this and link the project by hand:" \
        "  gcloud billing accounts list"
fi

tick "billing account: $ACCOUNT_DISPLAY ($ACCOUNT_ID)"

# ── 3 · create the project ────────────────────────────────────────────────────
# agent-valley-XXXX — the same shape week one uses, so week three can find this
# project the way section 1 just looked for week one's. Project IDs are unique
# across all of Google Cloud and a deleted ID stays reserved, so a collision is
# a normal outcome, not an error: retry with a new number before giving up.
say "2 · Project"

if [ -n "$ADOPT_PROJECT" ]; then
    PROJECT_ID="$ADOPT_PROJECT"
    tick "adopting $PROJECT_ID"
else
    PROJECT_ID=""
    CREATE_ERR=""
    for _ in $(seq 1 "$CREATE_ATTEMPTS"); do
        CANDIDATE="${PREFIX}$(printf '%04d' $((RANDOM % 10000)))"
        info "creating $CANDIDATE"
        if CREATE_ERR="$(gcloud projects create "$CANDIDATE" \
                --name="Agent Valley" 2>&1)"; then
            PROJECT_ID="$CANDIDATE"
            break
        fi
        warn "$CANDIDATE was refused, trying another ID"
    done

    if [ -z "$PROJECT_ID" ]; then
        die "Could not create a project after $CREATE_ATTEMPTS attempts." \
            "gcloud said:" \
            "" \
            "$CREATE_ERR" \
            "" \
            "Usual causes: you are at your project quota, or your account is in" \
            "an organization that does not let you create projects." \
            "" \
            "At quota because of week one? Reuse that project instead — point" \
            "this lab at it and re-run in reuse mode. Both lines matter: the" \
            "file says which project, the variable says to honour it." \
            "" \
            "       echo YOUR_WEEK_ONE_PROJECT_ID > ~/project_id.txt" \
            "       AGENT_VALLEY_REUSE_PROJECT=1 ./setup_project.sh" \
            "" \
            "Otherwise create one by hand — it takes a minute:" \
            "  1. https://console.cloud.google.com/projectcreate" \
            "  2. give it any name, note the PROJECT ID it assigns" \
            "  3. link billing:  Billing → Link a billing account" \
            "  4. tell this lab about it:" \
            "       echo YOUR_PROJECT_ID > ~/project_id.txt" \
            "       gcloud config set project YOUR_PROJECT_ID" \
            "  5. AGENT_VALLEY_REUSE_PROJECT=1 ./setup_project.sh"
    fi

    tick "created $PROJECT_ID"
fi

# ── 4 · link billing, record, and select ──────────────────────────────────────
# Record the ID the moment the project exists, before anything below it can
# fail. Every die() past this point tells you to re-run in reuse mode, and a
# re-run can only keep that promise if the ID is already on disk.
printf '%s\n' "$PROJECT_ID" > "$PROJECT_FILE"

if ! LINK_ERR="$(gcloud billing projects link "$PROJECT_ID" \
        --billing-account="$ACCOUNT_ID" 2>&1)"; then
    die "Could not link billing to $PROJECT_ID." \
        "gcloud said:" \
        "" \
        "$LINK_ERR" \
        "" \
        "Link it in the console:" \
        "  https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID" \
        "" \
        "Then re-run in reuse mode, so it picks $PROJECT_ID back up instead of" \
        "creating a second one:" \
        "" \
        "  AGENT_VALLEY_REUSE_PROJECT=1 ./setup_project.sh"
fi
tick "billing linked"

if ! SELECT_ERR="$(gcloud config set project "$PROJECT_ID" 2>&1)"; then
    die "Linked billing to $PROJECT_ID, but could not make it the active project." \
        "gcloud said:" \
        "" \
        "$SELECT_ERR" \
        "" \
        "$PROJECT_ID itself is fine, and it is already recorded in" \
        "$PROJECT_FILE. Select it by hand:" \
        "" \
        "  gcloud config set project $PROJECT_ID" \
        "" \
        "Then re-run in reuse mode, so it picks $PROJECT_ID back up instead of" \
        "creating a second one:" \
        "" \
        "  AGENT_VALLEY_REUSE_PROJECT=1 ./setup_project.sh"
fi
tick "recorded in $PROJECT_FILE and set as the active gcloud project"

# ── 5 · wait for the project to actually be allowed to serve ──────────────────
# A project that is seconds old will answer 403 IAM_PERMISSION_DENIED while its
# IAM policy propagates. ./setup_codelab.sh makes a real Gemini call almost
# immediately, so absorb that wait here instead of failing there. Reused
# projects never reach this section — they were already serving last week.
say "3 · Waiting for the project to come up"
info "a brand new project answers 403 for a minute or so — this is normal"

deadline=$(( SECONDS + READY_TIMEOUT ))
ready=0
while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(gcloud billing projects describe "$PROJECT_ID" \
                --format='value(billingEnabled)' 2>/dev/null)" = "True" ] \
       && gcloud services list --enabled --project="$PROJECT_ID" \
                --limit=1 --format='value(config.name)' >/dev/null 2>&1; then
        ready=1
        break
    fi
    printf '  · not ready yet, retrying in %ss\n' "$READY_INTERVAL"
    sleep "$READY_INTERVAL"
done

if [ "$ready" -ne 1 ]; then
    die "$PROJECT_ID is created and billing-linked, but still not serving after ${READY_TIMEOUT}s." \
        "Nothing is broken — new projects sometimes take longer than this to" \
        "propagate. Wait a minute, then run:" \
        "" \
        "  AGENT_VALLEY_REUSE_PROJECT=1 ./setup_project.sh" \
        "" \
        "The variable matters here: without it this script makes a NEW project" \
        "every time, and $PROJECT_ID is already paid for and nearly ready."
fi

tick "$PROJECT_ID is serving"

say "Project ready: $PROJECT_ID"
printf '  Next:  ./setup_codelab.sh\n\n'
