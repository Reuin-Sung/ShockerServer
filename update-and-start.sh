#!/bin/bash

# Script to update code from git, update packages, and start the application
# Usage: ./update-and-start.sh

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔄 Starting update process...${NC}"

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Step 1: Update from git
echo -e "${YELLOW}📥 Updating code from git...${NC}"
if git pull; then
    echo -e "${GREEN}✅ Git update completed${NC}"
else
    echo -e "${RED}❌ Git update failed${NC}"
    exit 1
fi

# Step 2: Update npm packages
echo -e "${YELLOW}📦 Updating npm packages...${NC}"
if npm install; then
    echo -e "${GREEN}✅ Package update completed${NC}"
else
    echo -e "${RED}❌ Package update failed${NC}"
    exit 1
fi

# Step 3: Start the application
echo -e "${YELLOW}🚀 Starting application...${NC}"
echo -e "${GREEN}✅ All updates completed successfully!${NC}"
echo -e "${YELLOW}⚠️  Application is starting... (Press Ctrl+C to stop)${NC}"
npm start

