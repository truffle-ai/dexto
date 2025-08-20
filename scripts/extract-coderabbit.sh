#!/bin/bash

# Extract CodeRabbit AI comments from GitHub PR with combinable filters
# Usage: ./extract-coderabbit.sh OWNER/REPO PR_NUMBER [FLAGS]

set -e

# Function to show usage
show_usage() {
    echo "Usage: $0 OWNER/REPO PR_NUMBER [FLAGS]"
    echo ""
    echo "FLAGS (can be combined):"
    echo "  --latest-only         Latest review by timestamp"
    echo "  --latest-actionable   Latest review with substantial feedback"
    echo "  --unresolved-only     Only unresolved comments"
    echo ""
    echo "Examples:"
    echo "  $0 truffle-ai/dexto 293                                    # All comments"
    echo "  $0 truffle-ai/dexto 293 --latest-only                     # Latest review by timestamp"
    echo "  $0 truffle-ai/dexto 293 --latest-actionable               # Latest actionable review"
    echo "  $0 truffle-ai/dexto 293 --unresolved-only                 # All unresolved comments"
    echo "  $0 truffle-ai/dexto 293 --latest-actionable --unresolved-only  # Unresolved from latest actionable"
    echo "  $0 truffle-ai/dexto 293 --latest-only --unresolved-only   # Unresolved from latest review"
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

while [[ $# -gt 0 ]]; do
    case $1 in
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

echo "🤖 Extracting CodeRabbit AI comments from $REPO PR #$PR_NUMBER"

# Build mode description
MODE_DESC="All CodeRabbit comments"
if [ "$LATEST_ONLY" = true ]; then
    MODE_DESC="Latest review (by timestamp)"
elif [ "$LATEST_ACTIONABLE" = true ]; then
    MODE_DESC="Latest actionable review"
fi

if [ "$UNRESOLVED_ONLY" = true ]; then
    if [ "$LATEST_ONLY" = true ] || [ "$LATEST_ACTIONABLE" = true ]; then
        MODE_DESC="$MODE_DESC - unresolved only"
    else
        MODE_DESC="All unresolved comments"
    fi
fi

echo "📋 Mode: $MODE_DESC"
echo "=================================================================="

# Step 1: Determine the scope (which review(s) to look at)
TARGET_REVIEW_ID=""

if [ "$LATEST_ONLY" = true ]; then
    # Get the most recent review by timestamp
    TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
        | jq -r '.[] | select(.user.login == "coderabbitai[bot]") | .id' \
        | tail -1)
    
    if [ -z "$TARGET_REVIEW_ID" ] || [ "$TARGET_REVIEW_ID" = "null" ]; then
        echo "❌ No CodeRabbit reviews found for this PR"
        exit 1
    fi
    echo "🔍 Latest review ID: $TARGET_REVIEW_ID"
    
elif [ "$LATEST_ACTIONABLE" = true ]; then
    # Get the most recent review with "Actionable comments posted:" in the body
    TARGET_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
        | jq -r '.[] | select(.user.login == "coderabbitai[bot]" and .body and (.body | contains("Actionable comments posted:"))) | .id' \
        | tail -1)
    
    if [ -z "$TARGET_REVIEW_ID" ] || [ "$TARGET_REVIEW_ID" = "null" ]; then
        echo "❌ No CodeRabbit actionable reviews found for this PR"
        exit 1
    fi
    echo "🔍 Latest actionable review ID: $TARGET_REVIEW_ID"
fi

# Step 2: Get the base set of comments based on scope
if [ -n "$TARGET_REVIEW_ID" ]; then
    # Get comments from specific review
    BASE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
        | jq --arg review_id "$TARGET_REVIEW_ID" '[.[] | select(.pull_request_review_id == ($review_id | tonumber))]')
else
    # Get all CodeRabbit comments
    BASE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
        | jq '[.[] | select(.user.login == "coderabbitai[bot]")]')
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
               select(.isResolved == false and .comments.nodes[0].author.login == "coderabbitai") |
               .comments.nodes[0].databaseId]')
    
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