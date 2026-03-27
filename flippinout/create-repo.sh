#!/bin/bash
# Create GitHub repo via API - will prompt for credentials if needed
curl -u mathmati https://api.github.com/user/repos \
  -d '{"name":"flippinout","description":"Authentic split-flap display for any screen - monochrome vintage themes, live clock, mechanical animations","private":false}' \
  2>&1 | head -20
