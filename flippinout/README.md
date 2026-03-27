# Flippinout — Authentic Split-Flap Display

Based on [magnum6actual/flipoff](https://github.com/magnum6actual/flipoff), enhanced with **authentic monochrome aesthetics**, improved mechanics, and clock mode.

## ✨ Key Improvements

### 🎨 Four Authentic Monochrome Themes
Real split-flap displays were **never multicolored**—they were mechanical, uniform, functional. This version respects that.

- **Classic Airport** — White on black (train stations, airports)
- **Vintage Amber** — 1970s airport terminal glow
- **Terminal Green** — Classic CRT aesthetic  
- **Railway Blue** — Modern European rail stations

Press **T** to cycle through themes — all monochrome, no rainbow scrambles

### ⏰ Live Clock Mode
- Real-time clock display with date
- Mechanical flip animation on every second
- Toggle with **C** key

### 🔧 Enhanced Mechanics
- **More authentic timing** — Slower, more deliberate flips (1.2s vs 0.8s scramble)
- **Better animation** — Mechanical bounce and overshoot on settle
- **Improved stagger** — 35ms delay between tiles (was 25ms)
- **Glowing accents** — Theme-colored indicators with glow effects
- **Vintage grain** — Subtle texture overlay for retro feel

### 🎯 Better Visuals
- **Larger tiles** — 40-68px (was 36-62px) for better legibility
- **Improved contrast** — Text shadow and glow for each theme
- **Deeper shadows** — More 3D depth on tiles
- **Smoother gaps** — 4-6px spacing (was 3-5px)

## 🎹 Keyboard Controls

| Key | Action |
|-----|--------|
| **Enter** | Next message |
| **←** | Previous message |
| **C** | Toggle clock mode |
| **T** | Cycle theme |
| **F** | Fullscreen |
| **M** | Mute/unmute |
| **N** | Show shortcuts |

## 🚀 Quick Start

1. Open `index.html` in a browser
2. Click "Try It Now" or press **F** for fullscreen
3. Press **C** for clock mode
4. Press **T** to change themes

## 🎬 Perfect For

- **Office lobbies** — Display time or rotating quotes
- **Home decor** — Vintage aesthetic on any TV
- **Events** — Retro countdown or info boards
- **Streaming overlays** — OBS browser source with character
- **Waiting rooms** — Calming mechanical animation

## 📦 What Changed

### Authenticity First
- **Removed multicolor scramble** — Real split-flap boards were monochrome, not rainbow
- **Monochrome themes** — Each theme uses one color, just like the real mechanical boards
- **No gimmicks** — Authentic to 1960s-80s airport/train station displays

### Code Improvements
- `ThemeManager.js` — Clean monochrome theme system with CSS variables
- `ClockMode.js` — Live clock display with date
- Enhanced timing constants for more mechanical feel
- Simplified tile animations (no color cycling)
- Better bounce/settle physics

### Visual Enhancements
- Vintage grain texture overlay
- Subtle glow on text (authentic phosphor/LED look)
- Improved tile shadows and depth
- Larger, bolder font (55% tile size, weight 900)
- Single accent color per theme (not cycling)

### UX Polish
- On-screen notifications for mode changes
- Keyboard hints in hero section
- Updated shortcuts overlay
- Honest copy (no marketing fluff)

## 🎨 Theme Philosophy

Each theme is **100% monochrome** because that's how real split-flap boards worked:
- One text color
- One background color
- No scramble color cycling
- Just mechanical character flipping

Authentic to: airports, train stations, baseball scoreboards, stock tickers.

## 📝 Credits

Original: [magnum6actual/flipoff](https://github.com/magnum6actual/flipoff)  
Enhanced by: Clawd (Mathew's AI assistant)

## 📄 License

Same as original — check original repo for license details.

---

**Press T to cycle themes · Press C for clock · Press F for fullscreen**
