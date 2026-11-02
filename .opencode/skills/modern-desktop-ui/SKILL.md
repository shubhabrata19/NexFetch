---
name: modern-desktop-ui
description: Design a modern, accessible NexFetch desktop experience that starts with YouTube downloads and evolves into a unified multi-engine download queue.
compatibility: opencode
---

# NexFetch modern desktop UI

## Product principle
NexFetch should feel calm, trustworthy, fast to understand, and task-focused. Functionality and clarity come before visual effects. The brand is a universal download manager; the first screen is focused on the YouTube MVP.

## MVP primary flow
**Paste YouTube URL → Fetch details → Inspect formats → Select quality → Download**

Keep this flow obvious. Do not require account creation or an onboarding wizard.

## YouTube MVP layout
- Persistent left navigation with the NexFetch brand, Downloads/History/Settings, active-download module, system status, version, and theme toggle.
- Paste-friendly URL field, clear validation, and fetch action.
- Video preview with thumbnail, title, channel, duration, and source URL.
- “Best available up to 4K” preset and scrollable actual format list.
- Format row: resolution, FPS, container, codec, audio/video indicators, and size when known. Render unknown sizes as blank space, not “Unknown.”
- Persistent right-side activity queue with active/queued and recent sections.
- Queue cards: two-line title, status, percent, speed, downloaded/total size, ETA, progress bar, and icon actions for stop, restart, open folder, and clear.
- Status uses semantic color plus a text label. Downloading status gets a gentle continuous pulse that stops under reduced motion.
- Clear confirmation happens inline inside the card with alert, confirm, and cancel icons; never use a blocking native dialog.

## Universal-manager evolution
When generic HTTP and BitTorrent engines are implemented, introduce a unified downloads area with filters such as All, Files, Videos, and Torrents. Reuse the common job card/list but show engine-specific details only for relevant jobs. Torrent details may include peers, seeds, verification, and seeding state. HTTP details may include source host, content length, and resume support. Video details may include selected resolution/container. Never display capabilities that an adapter does not support.

## Interaction rules
- Disable actions only when prerequisites are missing and explain why.
- Preserve the URL and metadata while the user changes format.
- Show determinate progress only when reliable; otherwise use indeterminate progress.
- Distinguish queued, resolving, downloading, verifying, completed, failed, and cancelled states where relevant.
- Do not claim pause/resume exists unless the engine genuinely supports it.
- Confirm destructive actions inline, not with a blocking native dialog. Clearing a record must never delete the downloaded file.
- Animate card removal gently after confirmation; respect reduced-motion preferences.
- Remember the last output directory and harmless preferences locally.
- Handle long titles, missing thumbnails, unknown size, narrow windows, and large format lists.
- Hide scrollbars visually only when wheel, trackpad, and keyboard scrolling still work.
- Provide a quick light/dark toggle in the sidebar while keeping System/Light/Dark available in Settings.

## Accessibility
- Semantic labels and keyboard access for every primary control.
- Visible focus and logical tab order.
- Screen-reader announcements for meaningful job-state changes.
- Sufficient contrast and status cues that do not rely on color alone.
- Respect reduced-motion preferences.

## Visual guidance
Use a restrained, consistent design system: readable typography, consistent spacing, and semantic colors for success/warning/error. NexFetch uses a red, black, and burgundy identity: deep burgundy navigation, black/burgundy surfaces in dark mode, and white/red surfaces in light mode. Keep the interface calm and avoid decorative gradients, glass effects, oversized hero sections, and unnecessary clutter.

## Completion checklist
- Empty/loading/success/no-results/error states exist.
- No visible control is inert.
- Keyboard-only operation works for the core flow.
- Future-engine controls are hidden until implemented.
- Layout works at practical desktop window sizes.
