#!/bin/bash
# Export database from OLD computer
# Run this on your current/old development computer
# Usage: bash EXPORT_DATABASE.sh

set -e

echo "📦 Exporting database from old computer..."
echo ""

# Check if database exists
if [ ! -f "roster.db" ]; then
    echo "❌ Database file (roster.db) not found!"
    echo "   Make sure you're in the project root directory"
    exit 1
fi

# Check if sqlite3 is available
if ! command -v sqlite3 &> /dev/null; then
    echo "❌ sqlite3 is required but not installed."
    echo "   Install it with: sudo apt-get install sqlite3"
    exit 1
fi

# Create backup directory
BACKUP_DIR="database_backups"
mkdir -p "$BACKUP_DIR"

# Create timestamped backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/database_backup_$TIMESTAMP.sql"

echo "💾 Exporting database to: $BACKUP_FILE"
sqlite3 roster.db .dump > "$BACKUP_FILE"

# Get file size
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

echo "✅ Database exported successfully!"
echo ""
echo "📋 Export Details:"
echo "   File: $BACKUP_FILE"
echo "   Size: $FILE_SIZE"
echo ""
echo "📤 Next steps:"
echo "   1. Transfer $BACKUP_FILE to your new computer"
echo "   2. On new computer, run: bash QUICK_START_NEW_COMPUTER.sh $BACKUP_FILE"
echo "   OR place it in the project root and run the setup script"
echo ""
