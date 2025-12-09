#!/bin/bash
# Run this on the SERVER to prepare files for transfer
# This exports database and lists what to transfer

set -e

echo "📦 Preparing files for transfer from server..."
echo ""

# Export database
echo "💾 Exporting database..."
bash EXPORT_DATABASE.sh

# Find the latest backup
LATEST_BACKUP=$(ls -t database_backups/*.sql 2>/dev/null | head -1)

if [ -n "$LATEST_BACKUP" ]; then
    echo ""
    echo "✅ Files ready for transfer!"
    echo ""
    echo "📤 Transfer to your local computer:"
    echo ""
    echo "From your LOCAL computer, run:"
    echo ""
    echo "  scp -P 33240 root@185.226.124.30:$(pwd)/$LATEST_BACKUP ./"
    echo ""
    echo "Or transfer everything:"
    echo "  scp -P 33240 root@185.226.124.30:$(pwd)/database_backups/*.sql ./"
    echo ""
else
    echo "⚠️  No database backup found"
fi

echo "📋 Summary:"
echo "   - Database backup: $LATEST_BACKUP"
echo "   - Code: Already in Git (just clone on new computer)"
echo ""

