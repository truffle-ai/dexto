#!/bin/bash

# Extract review comments from GitHub PR with combinable filters
# Usage: ./extract-review-comments.sh OWNER/REPO PR_NUMBER [--reviewer LOGIN_ID] [FLAGS]

set -e

# Function to show usage
show_usage() {
    echo "Usage: $0 OWNER/REPO PR_NUMBER [--reviewer LOGIN_ID] [FLAGS]"
    echo ""
    echo "OPTIONS:"
    echo "  --reviewer LOGIN_ID   Filter comments by specific reviewer (e.g., coderabbitai[bot], rahulkarajgikar)"
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

while [[ $# -gt 0 ]]; do
    case $1 in
        --reviewer)
            if [ -z "$2" ]; then
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

echo "📋 Mode: $MODE_DESC"
echo "=================================================================="

# Step 1: Determine the scope (which review(s) to look at)
TARGET_REVIEW_ID=""

if [ "$LATEST_ONLY" = true ]; then
    # Get the most recent review by timestamp
    if [ -n "$REVIEWER" ]; then
        # Filter by specific reviewer
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r --arg reviewer "$REVIEWER" '.[] | select(.user.login == $reviewer) | .id' \
            | tail -1)
        REVIEWER_DESC=" from $REVIEWER"
    else
        # Any reviewer
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r '.[] | .id' \
            | tail -1)
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
        # Filter by specific reviewer
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r --arg reviewer "$REVIEWER" '.[] | select(.user.login == $reviewer and .body != null and .body != "") | .id' \
            | tail -1)
        REVIEWER_DESC=" from $REVIEWER"
    else
        # Any reviewer
        TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r '.[] | select(.body != null and .body != "") | .id' \
            | tail -1)
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
        | jq --arg review_id "$TARGET_REVIEW_ID" '[.[] | select(.pull_request_review_id == ($review_id | tonumber))]')
else
    # Get all comments, optionally filtered by reviewer
    if [ -n "$REVIEWER" ]; then
        BASE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
            | jq --arg reviewer "$REVIEWER" '[.[] | select(.user.login == $reviewer)]')
    else
        BASE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
            | jq '[.[] | select(.user.login)]')  # All comments from any reviewer
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
                            comments(first: 10) {
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

# Step 4: Count and display results
COMMENT_COUNT=$(echo "$FILTERED_COMMENTS" | jq length)

if [ "$COMMENT_COUNT" -eq 0 ]; then
    echo "📊 No comments found matching the specified criteria"
    echo ""
    echo "✅ Done! Use 'gh pr view $PR_NUMBER --repo $REPO --web' to view the PR in browser"
    exit 0
fi

# Display the comments
echo "$FILTERED_COMMENTS" | jq -r '.[] |
    "📄 " + .path + ":" + (.line | tostring) + "\n" +
    "🆔 Comment ID: " + (.id | tostring) + "\n" +
    "📅 Created: " + .created_at + "\n" +
    "👍 Reactions: " + (.reactions.total_count | tostring) + 
    (if .pull_request_review_id then "\n🔗 Review ID: " + (.pull_request_review_id | tostring) else "" end) +
    "\n---\n" + .body + "\n" +
    "=================================================================="
'

echo ""
echo "📊 Summary: Found $COMMENT_COUNT comments matching criteria"

echo ""
echo "✅ Done! Use 'gh pr view $PR_NUMBER --repo $REPO --web' to view the PR in browser"