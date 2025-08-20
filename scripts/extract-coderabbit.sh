#!/bin/bash

# Extract CodeRabbit AI comments from GitHub PR
# Usage: ./extract-coderabbit.sh OWNER/REPO PR_NUMBER [--latest-only|--latest-actionable|--unresolved-only]

set -e

if [ $# -lt 2 ]; then
    echo "Usage: $0 OWNER/REPO PR_NUMBER [--latest-only|--latest-actionable|--unresolved-only]"
    echo "Examples:"
    echo "  $0 truffle-ai/dexto 293                      # All CodeRabbit comments"
    echo "  $0 truffle-ai/dexto 293 --latest-only       # Latest review by timestamp"
    echo "  $0 truffle-ai/dexto 293 --latest-actionable # Latest actionable review"
    echo "  $0 truffle-ai/dexto 293 --unresolved-only   # Unresolved comments only"
    exit 1
fi

REPO="$1"
PR_NUMBER="$2"
MODE="${3:-all}"

# Extract owner and repo name
IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

echo "🤖 Extracting CodeRabbit AI comments from $REPO PR #$PR_NUMBER"

case "$MODE" in
    "--latest-only")
        echo "📋 Mode: Latest review comments only"
        
        # Get the most recent CodeRabbit review ID
        LATEST_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r '.[] | select(.user.login == "coderabbitai[bot]") | .id' \
            | tail -1)
        
        if [ -z "$LATEST_REVIEW_ID" ] || [ "$LATEST_REVIEW_ID" = "null" ]; then
            echo "❌ No CodeRabbit reviews found for this PR"
            exit 1
        fi
        
        echo "🔍 Latest CodeRabbit review ID: $LATEST_REVIEW_ID"
        echo "=================================================================="
        
        # Get comments from that specific review and count them
        LATEST_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
            | jq --arg review_id "$LATEST_REVIEW_ID" '[.[] | select(.pull_request_review_id == ($review_id | tonumber))]')
        
        LATEST_COUNT=$(echo "$LATEST_COMMENTS" | jq length)
        
        echo "$LATEST_COMMENTS" | jq -r '.[] |
            "📄 " + .path + ":" + (.line | tostring) + "\n" +
            "🆔 Comment ID: " + (.id | tostring) + "\n" +
            "📅 Created: " + .created_at + "\n" +
            "👍 Reactions: " + (.reactions.total_count | tostring) + "\n" +
            "---\n" + .body + "\n" +
            "=================================================================="
        '
        
        echo ""
        echo "📊 Summary: Found $LATEST_COUNT comments in latest review"
        ;;
        
    "--latest-actionable")
        echo "📋 Mode: Latest actionable review comments only"
        
        # Find the most recent review with "Actionable comments posted:" in the body
        ACTIONABLE_REVIEW_ID=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
            | jq -r '.[] | select(.user.login == "coderabbitai[bot]" and .body and (.body | contains("Actionable comments posted:"))) | .id' \
            | tail -1)
        
        if [ -z "$ACTIONABLE_REVIEW_ID" ] || [ "$ACTIONABLE_REVIEW_ID" = "null" ]; then
            echo "❌ No CodeRabbit actionable reviews found for this PR"
            exit 1
        fi
        
        echo "🔍 Latest actionable CodeRabbit review ID: $ACTIONABLE_REVIEW_ID"
        echo "=================================================================="
        
        # Get comments from that specific actionable review and count them
        ACTIONABLE_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
            | jq --arg review_id "$ACTIONABLE_REVIEW_ID" '[.[] | select(.pull_request_review_id == ($review_id | tonumber))]')
        
        ACTIONABLE_COUNT=$(echo "$ACTIONABLE_COMMENTS" | jq length)
        
        echo "$ACTIONABLE_COMMENTS" | jq -r '.[] |
            "📄 " + .path + ":" + (.line | tostring) + "\n" +
            "🆔 Comment ID: " + (.id | tostring) + "\n" +
            "📅 Created: " + .created_at + "\n" +
            "👍 Reactions: " + (.reactions.total_count | tostring) + "\n" +
            "---\n" + .body + "\n" +
            "=================================================================="
        '
        
        echo ""
        echo "📊 Summary: Found $ACTIONABLE_COUNT comments in latest actionable review"
        ;;
        
    "--unresolved-only")
        echo "📋 Mode: Unresolved comments only"
        echo "=================================================================="
        
        # Use GraphQL to get unresolved review threads and count them
        UNRESOLVED_THREADS=$(gh api graphql -f query='
            query($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                    pullRequest(number: $number) {
                        reviewThreads(first: 50) {
                            nodes {
                                id
                                isResolved
                                comments(first: 10) {
                                    nodes {
                                        id
                                        author { login }
                                        path
                                        line
                                        body
                                        createdAt
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
            | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .comments.nodes[0].author.login == "coderabbitai")]')
        
        UNRESOLVED_COUNT=$(echo "$UNRESOLVED_THREADS" | jq length)
        
        echo "$UNRESOLVED_THREADS" | jq -r '.[] |
            .comments.nodes[0] |
            "📄 " + .path + ":" + (.line | tostring) + "\n" +
            "🆔 Comment ID: " + (.id | tostring) + "\n" +
            "📅 Created: " + .createdAt + "\n" +
            "🔄 Status: UNRESOLVED\n" +
            "---\n" + .body + "\n" +
            "=================================================================="
        '
        
        echo ""
        echo "📊 Summary: Found $UNRESOLVED_COUNT unresolved CodeRabbit comments"
        ;;
        
    *)
        echo "📋 Mode: All CodeRabbit comments"
        echo "=================================================================="
        
        # Get all CodeRabbit comments and count them
        ALL_COMMENTS=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
            | jq '[.[] | select(.user.login == "coderabbitai[bot]")]')
        
        ALL_COUNT=$(echo "$ALL_COMMENTS" | jq length)
        
        echo "$ALL_COMMENTS" | jq -r '.[] |
            "📄 " + .path + ":" + (.line | tostring) + "\n" +
            "🆔 Comment ID: " + (.id | tostring) + "\n" +
            "📅 Created: " + .created_at + "\n" +
            "👍 Reactions: " + (.reactions.total_count | tostring) + "\n" +
            "---\n" + .body + "\n" +
            "=================================================================="
        '
        
        echo ""
        echo "📊 Summary: Found $ALL_COUNT total CodeRabbit comments"
        ;;
esac

echo ""
echo "✅ Done! Use 'gh pr view $PR_NUMBER --repo $REPO --web' to view the PR in browser"