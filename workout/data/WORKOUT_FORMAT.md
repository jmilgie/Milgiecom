# Workout Program JSON Format

This document describes the JSON format for workout programs used by the Workout Coach app. Use this as a template when converting workout plans into the app's data format.

## JSON Structure

```json
{
  "id": "unique-program-id",
  "name": "Program Display Name",
  "description": "Brief description of the program and its goals.",
  "settings": {
    "prepTime": 8,
    "mainRest": 150,
    "accessoryRest": 75,
    "microRest": 60
  },
  "sessions": {
    "A": {
      "name": "Session A — Focus Areas",
      "exercises": [...]
    },
    "B": {
      "name": "Session B — Focus Areas",
      "exercises": [...]
    }
  },
  "instructions": {
    "Exercise Name": "<p><b>Setup:</b> Instructions...</p><p><b>Execution:</b> More instructions...</p>"
  }
}
```

## Field Descriptions

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (lowercase, hyphens, e.g., "upper-body-pull-up-focus") |
| `name` | string | Yes | Display name shown in program selector |
| `description` | string | Yes | Brief description of the program's purpose and target audience |
| `settings` | object | Yes | Default timing settings for this program |
| `sessions` | object | Yes | Workout sessions keyed by identifier (A, B, C, etc.) |
| `instructions` | object | Yes | Exercise instructions keyed by exercise name |

### Settings Object

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prepTime` | number | 8 | Seconds of preparation time before timed exercises |
| `mainRest` | number | 150 | Rest seconds after main/compound lifts |
| `accessoryRest` | number | 75 | Rest seconds after accessory exercises |
| `microRest` | number | 60 | Rest seconds for warm-up and light exercises |

### Session Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Full session name (e.g., "Upper A — Bench + Row") |
| `exercises` | array | Ordered list of exercise objects |

### Exercise Types

#### 1. Timed Sequence (`type: "timed-sequence"`)
For exercises with timed holds, negatives, or structured intervals.

```json
{
  "name": "Pull-up Practice",
  "type": "timed-sequence",
  "sequence": [
    { "name": "Top Hold", "time": 8, "rest": 60, "reps": 5 },
    { "name": "Negative", "time": 6, "rest": 60, "reps": 5, "instruction": "Optional extra cue" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for this exercise block |
| `type` | string | Yes | Must be `"timed-sequence"` |
| `sequence` | array | Yes | Array of timed sub-exercises |

Sequence item fields:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Sub-exercise name |
| `time` | number | No | Hold/work duration in seconds (null for untimed) |
| `rest` | number | Yes | Rest between reps in seconds |
| `reps` | number | Yes | Number of repetitions |
| `instruction` | string | No | Optional inline instruction |

#### 2. Sets (`type: "sets"`)
For traditional resistance exercises with sets and reps.

```json
{
  "name": "Barbell Bench Press",
  "type": "sets",
  "sets": 4,
  "reps": "5-8",
  "rest": "main",
  "note": "Optional alternative or tip"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Exercise name (should match key in instructions) |
| `type` | string | Yes | Must be `"sets"` |
| `sets` | number | Yes | Number of sets |
| `reps` | string | Yes | Rep range or description (e.g., "5-8", "10-15 each", "near failure") |
| `rest` | string | Yes | Rest category: `"main"`, `"accessory"`, or `"micro"` |
| `note` | string | No | Optional note about alternatives or form cues |

#### 3. Instruction (`type: "instruction"`)
For self-paced activities like warm-up ramp sets.

```json
{
  "name": "Ramp Sets",
  "type": "instruction",
  "time": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Activity name (should match key in instructions) |
| `type` | string | Yes | Must be `"instruction"` |
| `time` | null | Yes | Always null (user controls pace) |

#### 4. Complete (`type: "complete"`)
Marks the end of a workout session.

```json
{
  "name": "Finish",
  "type": "complete"
}
```

### Instructions Object

HTML-formatted instructions keyed by exercise name. Use simple HTML:
- `<p>` for paragraphs
- `<b>` for bold/emphasis
- Keep instructions concise and actionable

```json
{
  "Barbell Bench Press": "<p><b>Setup:</b> Eyes under bar, feet flat, grip just wider than shoulders.</p><p><b>Lower:</b> Bar to lower chest, elbows ~45° from torso.</p><p><b>Press:</b> Push up and slightly back. Keep shoulder blades pinned.</p>"
}
```

## LLM Prompt Template

Use this prompt to convert a workout plan:

---

**PROMPT:**

Convert the following workout plan into the Workout Coach JSON format.

Requirements:
1. Create a unique `id` (lowercase, hyphens)
2. Write a clear `name` and `description`
3. Set appropriate `settings` based on the workout type:
   - Strength focus: mainRest 150-180s, accessoryRest 90s
   - Hypertrophy focus: mainRest 90-120s, accessoryRest 60-75s
   - Endurance/circuit: mainRest 60s, accessoryRest 45s
4. Organize exercises into sessions (A, B, C, etc.)
5. Classify each exercise by type:
   - Use `timed-sequence` for holds, negatives, isometrics
   - Use `sets` for traditional lifting exercises
   - Use `instruction` for warm-ups, ramp sets, self-paced activities
   - End each session with `{ "name": "Finish", "type": "complete" }`
6. Write clear, actionable instructions for each unique exercise
7. Use rest categories appropriately:
   - `main`: compound lifts (bench, squat, deadlift, rows, OHP)
   - `accessory`: isolation and secondary exercises
   - `micro`: warm-up movements and light work

**WORKOUT PLAN TO CONVERT:**
[Paste workout plan here]

---

## Example: Minimal Program

```json
{
  "id": "simple-push-pull",
  "name": "Simple Push/Pull",
  "description": "A basic 2-day push/pull split for beginners.",
  "settings": {
    "prepTime": 8,
    "mainRest": 120,
    "accessoryRest": 60,
    "microRest": 45
  },
  "sessions": {
    "A": {
      "name": "Push Day — Chest, Shoulders, Triceps",
      "exercises": [
        { "name": "Warm-up", "type": "instruction", "time": null },
        { "name": "Bench Press", "type": "sets", "sets": 3, "reps": "8-10", "rest": "main" },
        { "name": "Overhead Press", "type": "sets", "sets": 3, "reps": "8-10", "rest": "main" },
        { "name": "Tricep Pushdown", "type": "sets", "sets": 3, "reps": "12-15", "rest": "accessory" },
        { "name": "Finish", "type": "complete" }
      ]
    },
    "B": {
      "name": "Pull Day — Back, Biceps",
      "exercises": [
        { "name": "Warm-up", "type": "instruction", "time": null },
        { "name": "Barbell Row", "type": "sets", "sets": 3, "reps": "8-10", "rest": "main" },
        { "name": "Lat Pulldown", "type": "sets", "sets": 3, "reps": "10-12", "rest": "accessory" },
        { "name": "Bicep Curl", "type": "sets", "sets": 3, "reps": "12-15", "rest": "accessory" },
        { "name": "Finish", "type": "complete" }
      ]
    }
  },
  "instructions": {
    "Warm-up": "<p><b>Complete 5-10 minutes of light cardio</b> followed by dynamic stretches for the muscles you'll be training.</p>",
    "Bench Press": "<p><b>Setup:</b> Lie on bench, feet flat, grip slightly wider than shoulders.</p><p><b>Execute:</b> Lower bar to chest, press up. Keep shoulder blades squeezed.</p>",
    "Overhead Press": "<p><b>Setup:</b> Bar at shoulders, feet shoulder-width.</p><p><b>Execute:</b> Press overhead, moving head back then forward under bar.</p>",
    "Tricep Pushdown": "<p><b>Setup:</b> Cable at high position, rope or bar attachment.</p><p><b>Execute:</b> Keep elbows pinned, extend arms fully, squeeze triceps.</p>",
    "Barbell Row": "<p><b>Setup:</b> Hinge at hips, back flat, grip shoulder-width.</p><p><b>Execute:</b> Pull bar to lower chest/upper abs, squeeze back, lower with control.</p>",
    "Lat Pulldown": "<p><b>Setup:</b> Grip slightly wider than shoulders, sit with thighs secured.</p><p><b>Execute:</b> Pull bar to upper chest, leading with elbows. Control the return.</p>",
    "Bicep Curl": "<p><b>Setup:</b> Stand tall, arms at sides.</p><p><b>Execute:</b> Curl weight up without swinging, lower with control.</p>",
    "Finish": "<p><b>Great work!</b> Hydrate and do some light stretching for the muscles you trained.</p>"
  }
}
```
