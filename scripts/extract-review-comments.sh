#!/bin/bash

# Extract review comments from GitHub PR with combinable filters
# Usage: ./extract-review-comments.sh OWNER/REPO PR_NUMBER [--reviewer LOGIN_ID] [FLAGS]

set -e
set -o pipefail

# Check dependencies early
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ Error: GitHub CLI (gh) is required but not installed" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "❌ Error: jq is required but not installed" >&2
  exit 1
fi

# Function to show usage
show_usage() {
    echo "Usage: $0 OWNER/REPO PR_NUMBER [--reviewer LOGIN_ID] [FLAGS]"
    echo ""
    echo "OPTIONS:"
    echo "  --reviewer LOGIN_ID   Filter comments by specific reviewer (e.g., coderabbitai[bot], rahulkarajgikar)"
    echo "  --limit NUMBER        Maximum number of comments to display (default: all)"
    echo "  --offset NUMBER       Number of comments to skip (default: 0, for pagination)"
    echo ""
    echo "FLAGS (can be combined):"
    echo "  --latest-only         Latest review by timestamp"
    echo "  --latest-actionable   Latest review with substantial feedback (has top-level summary)"
    echo "  --unresolved-only     Only unresolved comments"
    echo ""
    echo "Examples:"
    echo "  $0 truffle-ai/dexto 293                                          # All comments from all reviewers"
    echo "  $0 truffle-ai/dexto 293 --reviewer coderabbitai[bot]            # All CodeRabbit comments"
    echo "  $0 truffle-ai/dexto 293 --reviewer rahulkarajgikar --latest-actionable  # Latest actionable human review"
    echo "  $0 truffle-ai/dexto 293 --reviewer coderabbitai[bot] --unresolved-only  # Unresolved CodeRabbit comments"
    echo "  $0 truffle-ai/dexto 293 --latest-actionable --unresolved-only   # Unresolved from any latest actionable review"
    echo ""
    echo "Pagination examples:"
    echo "  $0 truffle-ai/dexto 293 --unresolved-only --limit 10           # First 10 comments"
    echo "  $0 truffle-ai/dexto 293 --unresolved-only --limit 10 --offset 10  # Next 10 comments (page 2)"
    echo "  $0 truffle-ai/dexto 293 --unresolved-only --limit 5 --offset 20   # Comments 21-25"
}

if [ $# -lt 2 ]; then
    show_usage
    exit 1
fi

REPO="$1"
PR_NUMBER="$2"
shift 2  # Remove first two args, leaving only flags

# Parse flags
LATEST_ONLY=false
LATEST_ACTIONABLE=false
UNRESOLVED_ONLY=false
REVIEWER=""
LIMIT=""
OFFSET="0"

while [[ $# -gt 0 ]]; do
    case $1 in
        --reviewer)
            if [ -z "$2" ] || [[ "$2" == --* || "$2" == -* ]]; then
                echo "❌ Error: --reviewer requires a login ID"
                exit 1
            fi
            REVIEWER="$2"
            shift 2
            ;;
        --latest-only)
            LATEST_ONLY=true
            shift
            ;;
        --latest-actionable)
            LATEST_ACTIONABLE=true
            shift
            ;;
        --unresolved-only)
            UNRESOLVED_ONLY=true
            shift
            ;;
        --limit)
            if [ -z "$2" ]; then
                echo "❌ Error: --limit requires a number"
                exit 1
            fi
            if ! [[ "$2" =~ ^[0-9]+$ ]] || [ "$2" -le 0 ]; then
                echo "❌ Error: --limit must be a positive integer"
                exit 1
            fi
            LIMIT="$2"
            shift 2
            ;;
        --offset)
            if [ -z "$2" ]; then
                echo "❌ Error: --offset requires a number"
                exit 1
            fi
            if ! [[ "$2" =~ ^[0-9]+$ ]]; then
                echo "❌ Error: --offset must be a non-negative integer"
                exit 1
            fi
            OFFSET="$2"
            shift 2
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown flag: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate conflicting flags
if [ "$LATEST_ONLY" = true ] && [ "$LATEST_ACTIONABLE" = true ]; then
    echo "❌ Error: Cannot use both --latest-only and --latest-actionable"
    exit 1
fi

# Extract owner and repo name
IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

# Build display text based on reviewer filter
if [ -n "$REVIEWER" ]; then
    echo "🤖 Extracting $REVIEWER comments from $REPO PR #$PR_NUMBER"
    BASE_DESC="$REVIEWER comments"
else
    echo "🤖 Extracting review comments from $REPO PR #$PR_NUMBER" 
    BASE_DESC="review comments"
fi

# Build mode description
MODE_DESC="All $BASE_DESC"
if [ "$LATEST_ONLY" = true ]; then
    MODE_DESC="Latest review (by timestamp)"
elif [ "$LATEST_ACTIONABLE" = true ]; then
    MODE_DESC="Latest actionable review"
fi

if [ "$UNRESOLVED_ONLY" = true ]; then
    if [ "$LATEST_ONLY" = true ] || [ "$LATEST_ACTIONABLE" = true ]; then
        MODE_DESC="$MODE_DESC - unresolved only"
    else
        MODE_DESC="All unresolved $BASE_DESC"
    fi
fi

# Add pagination info to mode description
if [ -n "$LIMIT" ]; then
    if [ "$OFFSET" != "0" ]; then
        MODE_DESC="$MODE_DESC (showing $LIMIT comments starting from #$((OFFSET + 1)))"
    else
        MODE_DESC="$MODE_DESC (showing first $LIMIT comments)"
    fi
fi

echo "📋 Mode: $MODE_DESC"
echo "=================================================================="

# Step 1: Determine the scope (which review(s) to look at)
TARGET_REVIEW_ID=""

if [ "$LATEST_ONLY" = true ]; then
    # Get the most recent review by timestamp
    if [ -n "$REVIEWER" ]; then
        # Filter by specific reviewer, then sort to most recent
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r --arg reviewer "$REVIEWER" '[.[] | select(.user.login == $reviewer)] | sort_by(.submitted_at // .created_at // .id) | last | .id')
        REVIEWER_DESC=" from $REVIEWER"
    else
        # Any reviewer, sort to most recent
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r '[.[]] | sort_by(.submitted_at // .created_at // .id) | last | .id')
        REVIEWER_DESC=""
    fi
    
    if [ -z "$TARGET_REVIEW_ID" ] || [ "$TARGET_REVIEW_ID" = "null" ]; then
        echo "❌ No reviews found${REVIEWER_DESC} for this PR"
        exit 1
    fi
    echo "🔍 Latest review ID: $TARGET_REVIEW_ID"
    
elif [ "$LATEST_ACTIONABLE" = true ]; then
    # Get the most recent review with a body (top-level summary = actionable review)
    if [ -n "$REVIEWER" ]; then
        # Filter by specific reviewer, then sort to most recent actionable
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r --arg reviewer "$REVIEWER" '[.[] | select(.user.login == $reviewer and .body != null and .body != "")] | sort_by(.submitted_at // .created_at // .id) | last | .id')
        REVIEWER_DESC=" from $REVIEWER"
    else
        # Any reviewer, most recent actionable
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r '[.[] | select(.body != null and .body != "")] | sort_by(.submitted_at // .created_at // .id) | last | .id')
        REVIEWER_DESC=""
    fi
    
    if [ -z "$TARGET_REVIEW_ID" ] || [ "$TARGET_REVIEW_ID" = "null" ]; then
        echo "❌ No actionable reviews found${REVIEWER_DESC} for this PR"
        exit 1
    fi
    echo "🔍 Latest actionable review ID: $TARGET_REVIEW_ID"
fi

# Step 2: Get the base set of comments based on scope
if [ -n "$TARGET_REVIEW_ID" ]; then
    # Get comments from specific review (already filtered by reviewer if specified)
    BASE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
        | jq -s --arg review_id "$TARGET_REVIEW_ID" '[ .[] | .[] | select(.pull_request_review_id == ($review_id | tonumber)) ]')
else
    # Get all comments, optionally filtered by reviewer
    if [ -n "$REVIEWER" ]; then
        BASE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
            | jq -s --arg reviewer "$REVIEWER" '[ .[] | .[] | select(.user.login == $reviewer) ]')
    else
        BASE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
            | jq -s '[ .[] | .[] | select(.user.login) ]')  # All comments from any reviewer
    fi
fi

# Step 3: Apply unresolved filter if requested
if [ "$UNRESOLVED_ONLY" = true ]; then
    # We need to cross-reference with GraphQL data for resolution status
    echo "🔄 Checking resolution status..."
    
    # Get unresolved thread data from GraphQL
    UNRESOLVED_THREADS=$(gh api graphql -f query='
        query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
                pullRequest(number: $number) {
                    reviewThreads(first: 100) {
                        nodes {
                            id
                            isResolved
                            comments(first: 100) {
                                nodes {
                                    id
                                    databaseId
                                    author { login }
                                }
                            }
                        }
                    }
                }
            }
        }' \
        -f owner="$OWNER" \
        -f repo="$REPO_NAME" \
        -F number="$PR_NUMBER" \
        | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | 
               select(.isResolved == false) |
               .comments.nodes[] | .databaseId]')
    
    # Filter BASE_COMMENTS to only include unresolved comment IDs
    FILTERED_COMMENTS=$(echo "$BASE_COMMENTS" | jq --argjson unresolved_ids "$UNRESOLVED_THREADS" '
        [.[] | select(.id as $id | $unresolved_ids | index($id))]')
else
    FILTERED_COMMENTS="$BASE_COMMENTS"
fi

# Step 4: Sort comments by file path and line number
SORTED_COMMENTS=$(echo "$FILTERED_COMMENTS" | jq 'sort_by([.path, .line // 0])')

# Step 5: Apply pagination if specified
if [ -n "$LIMIT" ]; then
    PAGINATED_COMMENTS=$(echo "$SORTED_COMMENTS" | jq --argjson limit "$LIMIT" --argjson offset "$OFFSET" '
        .[$offset:$offset + $limit]')
else
    PAGINATED_COMMENTS="$SORTED_COMMENTS"
fi

# Step 6: Count and display results
TOTAL_COUNT=$(echo "$SORTED_COMMENTS" | jq length)
DISPLAYED_COUNT=$(echo "$PAGINATED_COMMENTS" | jq length)

if [ "$TOTAL_COUNT" -eq 0 ]; then
    echo "📊 No comments found matching the specified criteria"
    echo ""
    echo "✅ Done! Use 'gh pr view $PR_NUMBER --repo $REPO --web' to view the PR in browser"
    exit 0
fi

# Display the comments with GitHub links
echo "$PAGINATED_COMMENTS" | jq -r --arg repo "$REPO" --arg pr "$PR_NUMBER" '.[] |
    "📄 " + .path + ":" + (.line | tostring) + "\n" +
    "🆔 Comment ID: " + (.id | tostring) + "\n" +
    "🔗 GitHub Link: https://github.com/" + $repo + "/pull/" + $pr + "#discussion_r" + (.id | tostring) + "\n" +
    "📅 Created: " + .created_at + "\n" +
    "👍 Reactions: " + (.reactions.total_count | tostring) + 
    (if .pull_request_review_id then "\n🔗 Review ID: " + (.pull_request_review_id | tostring) else "" end) +
    "\n---\n" + .body + "\n" +
    "=================================================================="
'

echo ""
if [ -n "$LIMIT" ]; then
    TOTAL_PAGES=$(( (TOTAL_COUNT + LIMIT - 1) / LIMIT ))
    CURRENT_PAGE=$(( OFFSET / LIMIT + 1 ))
    echo "📊 Summary: Showing $DISPLAYED_COUNT of $TOTAL_COUNT total comments (Page $CURRENT_PAGE of $TOTAL_PAGES)"
    
    # Show pagination hints
    if [ $CURRENT_PAGE -gt 1 ]; then
        PREV_OFFSET=$((OFFSET - LIMIT))
        if [ $PREV_OFFSET -lt 0 ]; then PREV_OFFSET=0; fi
        echo "⬅️  Previous page: $0 $REPO $PR_NUMBER $(echo "$@" | sed "s/--offset [0-9]*//" | sed "s/$/ --offset $PREV_OFFSET/")"
    fi
    
    if [ $CURRENT_PAGE -lt $TOTAL_PAGES ]; then
        NEXT_OFFSET=$((OFFSET + LIMIT))
        echo "➡️  Next page: $0 $REPO $PR_NUMBER $(echo "$@" | sed "s/--offset [0-9]*//" | sed "s/$/ --offset $NEXT_OFFSET/")"
    fi
else
    echo "📊 Summary: Found $TOTAL_COUNT comments matching criteria (sorted by file/line)"
fi

echo ""
echo "✅ Done! Use 'gh pr view $PR_NUMBER --repo $REPO --web' to view the PR in browser"