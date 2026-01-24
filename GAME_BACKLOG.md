# Criminal Empire - Product Backlog

## 🔴 Priority 1: Core Systems (Must Have)

### Issue 1: Implement Prestige/Reset System
**Priority:** P0 - Critical
**Labels:** enhancement, game-mechanics, high-priority
**Estimated Effort:** Large (3-5 days)

**Description:**
Add a prestige system that allows players to reset their progress in exchange for permanent bonuses, providing long-term replayability.

**User Story:**
As a player who has maxed out most upgrades, I want to prestige/retire to gain permanent bonuses so that I have a reason to keep playing and can progress faster on subsequent runs.

**Acceptance Criteria:**
- [ ] Add "Retire to Paradise" button (unlocks at max rank or specific milestone)
- [ ] Confirmation modal explaining what resets and what persists
- [ ] Prestige currency (e.g., "Legacy Points") awarded based on total earnings/reputation
- [ ] Permanent upgrade shop using Legacy Points (e.g., +5% all income, +10% click power, etc.)
- [ ] Track total prestiges completed
- [ ] Add prestige-specific achievements
- [ ] Visual indicator showing prestige level

**Technical Notes:**
- Store prestige data separately from regular save data
- Calculate prestige currency based on formula (e.g., sqrt(totalEarned/1000000))
- Prestige bonuses should be multiplicative with other bonuses

---

### Issue 2: Add Offline Progress System
**Priority:** P0 - Critical
**Labels:** enhancement, game-mechanics, high-priority
**Estimated Effort:** Medium (1-2 days)

**Description:**
Calculate and award earnings while the game is closed to maintain engagement for returning players.

**User Story:**
As a player who closes the game, I want to earn money while offline so that I'm rewarded for returning and don't feel like I'm falling behind.

**Acceptance Criteria:**
- [ ] Calculate time elapsed since last session
- [ ] Award offline earnings based on passive income rate
- [ ] Cap offline earnings at reasonable time (e.g., 4-8 hours max)
- [ ] Display welcome back modal showing offline earnings
- [ ] Option to watch ad for 2x offline earnings (optional)
- [ ] Offline earnings should respect global multipliers but not luck/crit
- [ ] Achievement for "First offline earnings"

**Technical Notes:**
- Store lastSeen timestamp in save data
- Calculate: offlineEarnings = min(elapsed, maxOfflineTime) * moneyPerSecond
- Consider adding offline earnings multiplier as prestige upgrade

---

### Issue 3: Implement Random Events System
**Priority:** P1 - High
**Labels:** enhancement, game-mechanics, content
**Estimated Effort:** Medium (2-3 days)

**Description:**
Add random events that create unexpected moments of risk, reward, and decision-making.

**User Story:**
As a player grinding through the game, I want random events to occur so that gameplay feels dynamic and unpredictable.

**Acceptance Criteria:**
- [ ] Event system triggers every 2-5 minutes during active play
- [ ] At least 10 different event types implemented:
  - **Lucky Break** - Find cash stash (instant money)
  - **Informant Tip** - Reduced heist cooldown for 2 minutes
  - **Police Raid** - Instant heat spike (lose some cash if storage not used)
  - **Crew Betrayal** - Random crew member steals larger amount
  - **Black Market Sale** - Next purchase 50% off (30 second timer)
  - **Rival Gang** - Must pay protection money or lose territory income temporarily
  - **Street Race** - Risk money for 3x return (click minigame)
  - **VIP Client** - Double passive income for 1 minute
  - **Heat Wave** - All heists cool down faster for 2 minutes
  - **Economic Boom** - All click earnings 2x for 30 seconds
- [ ] Events show in a modal/banner with clear actions
- [ ] Event log/history in stats page
- [ ] Sound effects for each event type
- [ ] Events respect game balance (rewards scale with progression)

**Technical Notes:**
- Use weighted random selection based on game state
- Some events only available after certain milestones
- Track event statistics for achievements

---

## 🟡 Priority 2: Gameplay Depth (Should Have)

### Issue 4: Add Rival Gangs Competition System
**Priority:** P1 - High
**Labels:** enhancement, game-mechanics, competitive
**Estimated Effort:** Large (4-6 days)

**Description:**
Introduce AI-controlled rival gangs that compete for territories, creating ongoing challenges and strategic depth.

**User Story:**
As a player who has captured territories, I want to defend them against rival gangs so that territory ownership feels meaningful and requires active management.

**Acceptance Criteria:**
- [ ] 3-5 rival gangs with unique names, colors, and personalities
- [ ] Rivals attempt to capture player's territories periodically
- [ ] Territory defense success based on:
  - Crew strength (count + training levels)
  - Heat level (high heat = vulnerable)
  - Territory level (harder to take higher level)
- [ ] Notification system for territory attacks
- [ ] Option to launch counter-attacks on rival territories
- [ ] Rival strength scales with player progression
- [ ] Victory/defeat outcomes affect reputation and territory control
- [ ] "Gang War" tab showing all gangs and their territories
- [ ] Achievements for defeating rivals

**Technical Notes:**
- Simulate rival actions during active play (not offline)
- Balance attack frequency to create tension without frustration
- Consider adding alliances/truces as advanced feature

---

### Issue 5: Expand Crew Mission System
**Priority:** P1 - High
**Labels:** enhancement, crew-system, content
**Estimated Effort:** Medium (2-3 days)

**Description:**
Allow players to send individual crew members on timed missions for rewards, making crew management more strategic.

**User Story:**
As a player with multiple crew members, I want to send them on individual missions so that I can actively use my crew beyond passive income.

**Acceptance Criteria:**
- [ ] New "Missions" panel in Crew tab
- [ ] 8-10 mission types with varying durations (5min to 4 hours):
  - **Quick Pickpocket** - 5min, small cash reward
  - **Car Boost** - 15min, medium cash
  - **Building Scout** - 30min, reduce next heist cooldown
  - **Weapons Deal** - 1hr, large cash + reputation
  - **Recruit Search** - 2hr, chance to find new crew member
  - **Training Camp** - 4hr, gain +1 random skill level
- [ ] Mission success rate based on crew skills and type
- [ ] Crew unavailable for passive income while on mission
- [ ] Multiple crew can do different missions simultaneously
- [ ] Mission rewards scale with crew rank
- [ ] Visual timer showing mission progress
- [ ] Notification when mission completes
- [ ] Failed missions result in crew injury (reduced stats for 10min)

**Technical Notes:**
- Store mission start time and duration in crew object
- Calculate completion on next update tick
- Consider crew type bonuses for specific missions

---

### Issue 6: Add Resource Diversity (Multiple Currencies)
**Priority:** P2 - Medium
**Labels:** enhancement, game-mechanics, economy
**Estimated Effort:** Large (5-7 days)

**Description:**
Introduce additional currencies (Influence, Weapons, etc.) to create deeper economic strategy and unlock new progression paths.

**User Story:**
As a player, I want multiple currencies to manage so that I can make strategic decisions about resource allocation and unlock different progression paths.

**Acceptance Criteria:**
- [ ] Add 2-3 new currencies:
  - **Influence** - Earned from reputation, used for political favors
  - **Weapons** - Earned from missions/heists, used for crew equipment
  - **Contraband** - Earned from smuggling, used for black market
- [ ] Each currency has dedicated display in UI
- [ ] New shops/systems for each currency
- [ ] Cross-currency exchange system (with poor rates to discourage)
- [ ] Certain upgrades require multiple currencies
- [ ] Daily/weekly caps on some currencies to pace progression
- [ ] Achievements for reaching milestones in each currency

**Technical Notes:**
- Major refactor of economy system
- Ensure balance so no single currency dominates meta
- Consider prestige bonuses for each currency type

---

## 🟢 Priority 3: Polish & Content (Nice to Have)

### Issue 7: Create Empire Map Visualization
**Priority:** P2 - Medium
**Labels:** enhancement, ui-ux, visual
**Estimated Effort:** Medium (3-4 days)

**Description:**
Add a visual map showing controlled territories, rival gang positions, and strategic overview of the empire.

**User Story:**
As a player, I want to see a map of my criminal empire so that I can visualize my progress and feel more immersed in the game world.

**Acceptance Criteria:**
- [ ] Interactive city map showing all territory locations
- [ ] Visual indicators for:
  - Owned territories (color-coded by upgrade level)
  - Locked territories (grayed out)
  - Contested territories (flashing if under attack)
  - Rival gang territories (different colors)
- [ ] Click territory on map to open upgrade panel
- [ ] Zoom in/out functionality
- [ ] Animated expansion effect when capturing new territory
- [ ] Icons showing active businesses in each district
- [ ] "Heat map" overlay showing police presence

**Technical Notes:**
- Use CSS/SVG for map rendering
- Mobile-friendly touch controls
- Consider using existing territory images as map sections

---

### Issue 8: Enhance Crew Visual System
**Priority:** P2 - Medium
**Labels:** enhancement, crew-system, visual
**Estimated Effort:** Small (1-2 days)

**Description:**
Add visual portraits/avatars and better crew member presentation to increase player attachment.

**User Story:**
As a player, I want my crew members to have unique visual identities so that I feel more connected to them and care about their development.

**Acceptance Criteria:**
- [ ] Generate unique avatar for each crew member (emoji combo or simple graphics)
- [ ] Different visual styles for each crew type
- [ ] Visual indicators for:
  - Rank (stars, badges)
  - Current activity (on mission, idle, working)
  - Loyalty/mood (happy, neutral, angry faces)
- [ ] Crew card design improvements
- [ ] Hover effects showing detailed stats
- [ ] Animation when crew levels up
- [ ] "Featured Crew" highlighting your best member

**Technical Notes:**
- Keep visuals lightweight for performance
- Consider procedural generation for variety
- Emoji combinations could work well for quick implementation

---

### Issue 9: Add Daily/Weekly Challenge System
**Priority:** P2 - Medium
**Labels:** enhancement, content, engagement
**Estimated Effort:** Medium (2-3 days)

**Description:**
Implement rotating challenges that give players daily goals and bonus rewards.

**User Story:**
As a player, I want daily challenges to complete so that I have short-term goals and reasons to log in every day.

**Acceptance Criteria:**
- [ ] 3 daily challenges refresh every 24 hours
- [ ] 3 weekly challenges refresh every 7 days
- [ ] Challenge types include:
  - "Click 500 times today"
  - "Earn $X in passive income"
  - "Complete 5 heists"
  - "Hire 3 crew members"
  - "Capture a territory"
  - "Reach 0% heat"
  - "Don't let crew steal from you for 1 day"
- [ ] Completion rewards: bonus cash, reputation, or prestige currency
- [ ] Challenge UI panel showing progress
- [ ] Visual notification when challenge completed
- [ ] Streak bonuses for completing challenges X days in a row
- [ ] Special weekly mega-challenge for large reward

**Technical Notes:**
- Generate challenges from pool based on player progression
- Store challenge state with reset timestamps
- Don't make challenges feel like chores (keep fun/achievable)

---

### Issue 10: Implement Leaderboards/Stats Tracking
**Priority:** P3 - Low
**Labels:** enhancement, social, stats
**Estimated Effort:** Medium (2-3 days)

**Description:**
Add comprehensive statistics tracking and local/global leaderboards for competitive players.

**User Story:**
As a competitive player, I want to see how I rank against others so that I have goals to strive for and can show off my progress.

**Acceptance Criteria:**
- [ ] Extended stats page tracking:
  - Total money earned (all time)
  - Fastest prestige time
  - Most crew members hired
  - Highest combo streak
  - Total heists completed
  - Territories captured
  - Time played
- [ ] Local leaderboards (stored in localStorage):
  - Highest money
  - Fastest to max rank
  - Most prestiges
- [ ] Option to export/share stats
- [ ] Milestones with unique badges
- [ ] Comparison with personal bests
- [ ] Achievement for reaching top of leaderboard

**Technical Notes:**
- Start with local-only leaderboards
- Could add backend integration later for global leaderboards
- Privacy considerations for any shared data

---

## ⚖️ Priority 4: Balance & Bug Fixes

### Issue 11: Balance Pass - Click Upgrade Economy
**Priority:** P1 - High
**Labels:** balance, bug, economy
**Estimated Effort:** Small (few hours)

**Description:**
Review and adjust click upgrade costs to ensure smooth progression throughout the game.

**User Story:**
As a player, I want click upgrades to feel achievable and worthwhile so that I'm motivated to purchase them as I progress.

**Acceptance Criteria:**
- [ ] Playtest full progression from start to end
- [ ] Ensure each click upgrade is achievable within reasonable time
- [ ] No massive cost spikes between tiers
- [ ] Click income remains relevant vs passive income
- [ ] Document recommended cost multipliers
- [ ] Add auto-balance formula based on passive income rate

**Technical Notes:**
- Current multipliers: 1.4-1.8 (may need further reduction)
- Consider dynamic pricing based on passive income
- Test with both active clicking and idle playstyles

---

### Issue 12: Balance Pass - Business & Heist Scaling
**Priority:** P1 - High
**Labels:** balance, economy
**Estimated Effort:** Small (1 day)

**Description:**
Ensure businesses and heists provide balanced risk/reward throughout progression.

**User Story:**
As a player, I want all content to feel worthwhile at appropriate progression levels so that I have meaningful choices about what to invest in.

**Acceptance Criteria:**
- [ ] Review passive income scaling curve
- [ ] Ensure heist rewards justify cooldown and risk
- [ ] No "dead" upgrades that are never worth buying
- [ ] Late-game content provides meaningful progression
- [ ] Document optimal purchase order for efficiency
- [ ] Balance minigame rewards vs base income

**Technical Notes:**
- May need to adjust business income multipliers
- Heist rewards should scale with heat risk
- Consider adding "fast forward" option for high prestige players

---

### Issue 13: Mobile Optimization & Touch Controls
**Priority:** P1 - High
**Labels:** bug, mobile, ui-ux
**Estimated Effort:** Medium (1-2 days)

**Description:**
Ensure game is fully playable and optimized for mobile devices with proper touch controls.

**Acceptance Criteria:**
- [ ] Test on various mobile devices (iOS/Android)
- [ ] Ensure all buttons are easily tappable (minimum 44x44px)
- [ ] Fix any overflow/scrolling issues
- [ ] Optimize tap button area (already improved but verify)
- [ ] Prevent accidental zooms
- [ ] Handle mobile-specific events (vibration working, sounds working)
- [ ] Vertical layout optimizations
- [ ] Loading performance on slower devices
- [ ] Save data works across browser sessions

**Technical Notes:**
- Use touch-action CSS properties
- Test viewport meta tags
- Consider PWA implementation for install option

---

## 📋 Implementation Script

You can create these issues in bulk using the GitHub CLI. Save this script as `create_backlog.sh`:

```bash
#!/bin/bash

# Issue 1: Prestige System
gh issue create --title "Implement Prestige/Reset System" \
  --label "enhancement,game-mechanics,high-priority" \
  --body-file - <<'EOF'
## Priority: P0 - Critical

Add a prestige system that allows players to reset their progress in exchange for permanent bonuses.

### Acceptance Criteria
- [ ] Add "Retire to Paradise" button (unlocks at max rank)
- [ ] Prestige currency awarded based on total earnings
- [ ] Permanent upgrade shop using prestige currency
- [ ] Track total prestiges completed
- [ ] Add prestige-specific achievements
- [ ] Visual indicator showing prestige level

See GAME_BACKLOG.md for full details.
EOF

# Issue 2: Offline Progress
gh issue create --title "Add Offline Progress System" \
  --label "enhancement,game-mechanics,high-priority" \
  --body-file - <<'EOF'
## Priority: P0 - Critical

Calculate and award earnings while game is closed.

### Acceptance Criteria
- [ ] Calculate time elapsed since last session
- [ ] Award offline earnings based on passive income
- [ ] Cap offline earnings at 4-8 hours max
- [ ] Display welcome back modal with earnings
- [ ] Offline earnings respect global multipliers

See GAME_BACKLOG.md for full details.
EOF

# Issue 3: Random Events
gh issue create --title "Implement Random Events System" \
  --label "enhancement,game-mechanics,content" \
  --body-file - <<'EOF'
## Priority: P1 - High

Add random events for dynamic gameplay.

### Acceptance Criteria
- [ ] Event system triggers every 2-5 minutes
- [ ] At least 10 different event types
- [ ] Events show in modal/banner
- [ ] Event log/history
- [ ] Sound effects for events

See GAME_BACKLOG.md for full details.
EOF

# Continue for remaining issues...
# (Add similar blocks for issues 4-13)

echo "✅ Backlog created! View at: https://github.com/jmilgie/Milgiecom/issues"
```

---

## 🚀 Quick Start

1. **Review this backlog** and adjust priorities
2. **Run the script** above (or create issues manually)
3. **Start with P0 items** (Prestige, Offline Progress)
4. **Iterate and gather feedback**

---

*Generated for Criminal Empire idle game - Last updated: 2026-01-24*
