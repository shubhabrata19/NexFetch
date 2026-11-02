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
- Compact NexFetch header with settings/help.
- Paste-friendly URL field, clear validation, and fetch action.
- Video preview with thumbnail, title, channel, duration, and source URL.
- “Best available up to 4K” preset and scrollable actual format list.
- Format row: resolution, FPS, container, codec, audio/video indicators, size estimate or “Unknown.”
- Download queue with status, progress, speed/ETA where available, cancel/retry, and open destination folder.

## Universal-manager evolution
When generic HTTP and BitTorrent engines are implemented, introduce a unified downloads area with filters such as All, Files, Videos, and Torrents. Reuse the common job card/list but show engine-specific details only for relevant jobs. Torrent details may include peers, seeds, verification, and seeding state. HTTP details may include source host, content length, and resume support. Video details may include selected resolution/container. Never display capabilities that an adapter does not support.

## Interaction rules
- Disable actions only when prerequisites are missing and explain why.
- Preserve the URL and metadata while the user changes format.
- Show determinate progress only when reliable; otherwise use indeterminate progress.
- Distinguish queued, resolving, downloading, verifying, completed, failed, and cancelled states where relevant.
- Do not claim pause/resume exists unless the engine genuinely supports it.
- Confirm destructive actions, not ordinary navigation.
- Remember the last output directory and harmless preferences locally.
- Handle long titles, missing thumbnails, unknown size, narrow windows, and large format lists.

## Accessibility
- Semantic labels and keyboard access for every primary control.
- Visible focus and logical tab order.
- Screen-reader announcements for meaningful job-state changes.
- Sufficient contrast and status cues that do not rely on color alone.
- Respect reduced-motion preferences.

## Visual guidance
Use a restrained, consistent design system: readable typography, consistent spacing, neutral surfaces, one clear accent, and semantic colors for success/warning/error. Avoid decorative gradients, glass effects, oversized hero sections, and unnecessary clutter.

## Completion checklist
- Empty/loading/success/no-results/error states exist.
- No visible control is inert.
- Keyboard-only operation works for the core flow.
- Future-engine controls are hidden until implemented.
- Layout works at practical desktop window sizes.
