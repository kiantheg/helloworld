# Caption Studio Usability Changes

This document summarizes the UI and UX changes made in this session and explains why they were made based on user testing feedback.

## Goal

Clean up the UI, reduce confusion, and fix the most important usability issues without changing the app's core functionality or design language more than necessary.

## User Feedback Summary

### User 1

What they liked:
- Keyboard shortcuts
- Different layouts
- Queue jumping

Main issues:
- Could not tell in wall mode whether a caption had been liked or disliked
- Shortcuts should be shown immediately, not hidden in menus
- Options dropdown was broken
- Focus mode and loaded-caption counts did not feel useful
- Upload preview did not update right away
- The number of buttons felt overwhelming

### User 2

What they liked:
- Queue
- Relative timestamps like "3h ago"
- Top / New toggles

Main issues:
- Too many buttons and some felt redundant
- Buttons moved around too much
- UI felt overstimulating
- Tried to use up/down for like/dislike, but the app used `L` and `D`

### User 3

What they liked:
- Skip and go back
- Stage view for images and captions
- Fonts, colors, and overall cohesion

Main issues:
- Options menu was cut off
- Focus mode should be removed
- Search/filter by keyword would help
- Stage nav looked like a button when it should not
- Queue may be too prominent
- In smaller windows, like/dislike appeared above the content and it was unclear what the vote applied to
- "60 more loaded" was confusing

## Changes Made

### 1. Simplified the top-level controls

What changed:
- Reduced header clutter and grouped controls more cleanly
- Removed the old options dropdown
- Replaced it with a direct `Show Shortcuts` / `Hide Shortcuts` button
- Simplified loaded-count language from `"60 captions ready"` style messaging to a smaller, clearer status chip
- Renamed `"Load 60 More"` to `"Load More"`

Why:
- Users 1 and 2 both felt the UI had too many buttons
- User 2 specifically noted that controls moved around too much and were overstimulating
- User 3 found `"60 more loaded"` confusing
- User 1 said the options dropdown was broken

### 2. Removed focus mode completely

What changed:
- Deleted focus mode UI, state, persistence, and layout branches

Why:
- User 1 did not see the need for focus mode
- User 3 explicitly said to get rid of focus mode
- Keeping it added complexity without helping first-time users

### 3. Made shortcuts visible immediately

What changed:
- Added a first-load shortcut hint/banner
- Added a direct shortcuts toggle in the header
- Updated visible shortcut guidance in rating and stage views

Why:
- User 1 said the app should tell users shortcuts right away
- User 1 initially did not know shortcuts existed
- Keyboard shortcuts were one of the most-liked features, so discoverability mattered

### 4. Changed keyboard behavior to match user expectations

What changed:
- `↑` = Like
- `↓` = Dislike
- `←` = Previous
- `→` = Next
- `U` = Undo last vote
- Removed `L` / `D` as reaction shortcuts

Why:
- User 2 naturally tried to use up/down to react
- Users liked shortcuts, but they needed to match intuition
- Undo is now easier to access without moving to the toast

### 5. Improved like/dislike clarity in wall mode and stage mode

What changed:
- Added clearer reaction state indicators like `Liked`, `Disliked`, and `No reaction saved yet`
- Added clearer copy explaining that reactions apply to the current image/caption pair
- Kept like/dislike controls anchored consistently in the card footer
- Prevented reaction controls from floating into confusing positions on smaller layouts

Why:
- User 1 could not tell whether he had liked or disliked a wall item
- User 3 asked whether like/dislike corresponded to the image
- User 3 saw the controls appear above the content in a smaller browser window, which made the target of the action unclear

### 6. Made wall cards open stage mode on click

What changed:
- Clicking anywhere on a wall card opens Stage mode
- Like/Dislike buttons still work independently via event propagation control

Why:
- This reduces button dependence and simplifies the interface
- It supports the layout/view-switching behavior users liked without forcing them to target a separate small button

### 7. Reworked stage mode hierarchy

What changed:
- Simplified the stage layout so the current image/caption remains primary
- Kept skip/back obvious
- Renamed queue language to `Next Up`
- Made the queue easier to scan and jump through
- Removed misleading stage-nav presentation that looked too button-like in the header area

Why:
- User 3 liked stage view but found the stage nav confusing
- User 3 questioned whether the queue should be so prominent
- Users liked queue-jumping, so the queue was kept but made clearer and less visually distracting

### 8. Repaired broken/cut-off UI elements

What changed:
- Removed the broken dropdown flow
- Fixed menu clipping issues
- Cleaned up panel and background seams that created visible cutoff lines
- Made the global background layers consistent across rating and upload sections

Why:
- User 1 said the dropdown was broken
- User 3 said the options menu was cut off
- Later visual QA in this session revealed additional seam/cutoff artifacts that were cleaned up

### 9. Improved upload feedback and history preview behavior

What changed:
- Upload preview now updates immediately when a file is selected or dropped
- Upload status messaging is shown more clearly
- Selecting an item from upload history now updates the main preview panel and preview captions, not just the side list

Why:
- User 1 said uploaded images did not appear in preview right away
- History images should feel like first-class preview targets, not secondary metadata

### 10. Added lightweight search/filter

What changed:
- Added keyword filtering for captions in rating mode

Why:
- User 3 explicitly suggested searching for specific keywords
- This was straightforward to add without changing core app flow

### 11. Made ranking legible in `Top`

What changed:
- Added visible net score badges on cards and in stage view
- Made `Top` a strict net-score sort
- Made `New` a strict created-time sort

Why:
- Without visible score feedback, `Top` felt arbitrary
- User 2 liked the `Top / New` toggles, so they were preserved and clarified
- The UI now explains why an item is high in `Top`

## Product Decisions Preserved

The following were kept because users responded positively to them:
- Keyboard shortcuts
- Multiple layouts/views
- Queue jumping
- Top / New toggles
- Skip / Go back
- Relative timestamps
- Fonts, colors, and overall visual identity

## Overall Rationale

The session changes were guided by a few repeated patterns in the feedback:

- Users liked the app's core structure, but the UI felt too busy
- Keyboard shortcuts were a strength, but they were hidden or unintuitive
- Layout instability and control placement created confusion, especially on smaller windows
- Broken or cut-off UI elements damaged trust quickly
- Users did not want extra complexity unless it clearly improved the main task

So the work focused on:
- reducing control clutter
- making actions self-explanatory
- preserving the app's distinctive visual style
- improving consistency and responsiveness
- keeping the features users already liked
