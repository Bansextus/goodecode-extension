# Changelog

## 0.0.40

- makes `Open Goodebot` require choosing an existing robot profile or `New Profile`
- shows a pre-launch review popup with the profile data summary and files already stored in the selected profile
- launches exported profile apps directly and creates an isolated launch app for saved profile JSON files

## 0.0.39

- shows the Goodebot app/build version each scanned robot profile was made with
- keeps schema version separate from the made-with Goodebot version in the update profile picker

## 0.0.38

- changes the Goodebot update picker to scan robot profiles instead of `Goodebot.app` copies
- shows exported profile apps and saved profile JSONs with profile name, path, schema version, and legacy upgrade notes
- preserves the selected profile seed and branding files when replacing a standalone profile app with a released Goodebot build

## 0.0.37

- removes the public Goodebot Dev download command from Goodecode
- limits the Goodebot install/update picker to released GitHub builds only
- splits the picker into Latest Release and Previous Releases so old local/dev zips no longer appear

## 0.0.36

- shows only numbered `V3.xx` Goodebot builds in the update picker
- stops creating a fake `Goodebot-dev-macOS.zip` row when only numbered dev builds should be selectable
- reads shared release metadata so uploaded numbered beta artifacts keep their human version labels
- keeps old generic/non-numbered Goodebot releases out of the install picker

## 0.0.35

- labels Goodebot update choices with clear version/build numbers before the source name
- limits install/update source scanning to Goodebot Dev local lanes plus shared GitHub releases, so random old Mac zips no longer appear
- checks shared Goodebot GitHub releases each time the picker opens and sorts newest builds first
- removes the old in-app Updates tab from Goodebot Settings
- expands Goodebot profile scanning to find saved profiles and embedded app profiles without returning random JSON files

## 0.0.34

- makes the Goodebot updater choose both the target app and the exact build zip/app to install
- lists local dev builds and shared Goodebot GitHub builds before falling back to downloads, avoiding stale latest-release installs
- tightens Goodecode Studio card sizing so guide/starter buttons no longer stretch into tall blocks
- keeps empty restored Goodebot workspaces on the Create/Import screen instead of reopening a blank workflow tab

## 0.0.33

- scans the Mac for Goodebot apps before updating so the user can choose the exact app copy VS Code should replace
- writes the chosen update target into the Legacy migration file and backs up that selected app before replacement
- replaces the placeholder credits with transparent VEX Robotics and `Bansextus(343K);` logo assets
- removes the visible color-label chips from the Studio credits card

## 0.0.32

- moves Goodebot updating into Goodecode Studio with workspace path, install status, backup, personalization, and Legacy migration file output
- updates visible team branding to `Bansextus(343K);`
- lightens the Studio blues and adds the refreshed blue, yellow, and green accent palette
- adds the VEX/Bansextus(343K): credit section to Goodecode Studio

## 0.0.31

- fixes the blank Goodecode Studio editor tab caused by a removed Goodebot Dev card helper still being called

## 0.0.30

- renames the VS Code extension display name from `Goodecode by BanSextus` to `Goodecode`
- keeps the Marketplace publisher identity unchanged while simplifying the visible extension name

## 0.0.29

- improves Goodecode sidebar and Studio open time by removing slow Spotlight searches from page render
- adds short-lived render-state caching so repeated refreshes do not re-run the same workspace checks immediately
- caps Goodecode file scanning and skips heavy folders such as builds, third-party dependencies, `.build`, and `node_modules`
- caches Python detection with a short timeout so the UI does not hang while checking local tooling

## 0.0.28

- removes Goodebot Dev download buttons and cards from Goodecode pages
- keeps Goodebot Dev available through the Command Palette command `Goodecode: Download Goodebot Dev`
- keeps the Goodebot Dev download password prompt in the command flow

## 0.0.27

- adds the Goodebot Dev download command with password protection
- packages the current Goodebot Dev build alongside the Goodecode dev artifacts
- adds Goodebot Dev as a separate macOS app for staging Goodecode and Goodebot dev, beta, and release builds
- adds GitHub sign-in attribution for uploaded builds in Goodebot Dev
- adds renameable build lists under dev and beta build lanes
- clears dev folders after moving builds to beta and clears beta folders after release
- updates Goodebot Dev with Goodebot-style theming, a custom app icon, and the `03 Ion Gate` startup sound
- updates Goodebot Dev packaging so each app change refreshes the dev zip
- adds Marketplace publishing to the Goodecode release flow after the personal release code and VS Code Marketplace token are provided

## 0.0.26

- improves Goodebot update behavior so locally created or imported data is preserved after updating
- fixes Goodebot import handling for configurable drive ports
- corrects imported mechanism names so hinge and arm are not mislabeled as intake/outake or generic mechanism A/B
- improves save behavior when imported Goodecode settings are edited

## 0.0.22

- refocuses the extension on the native Goodebot app workflow
- keeps `Build For Goodebot` as the single runtime export path from the extension
- updates the extension page copy to describe the native Goodebot flow only

## 0.0.20

- aligns the extension shell more closely with the Mac app structure
- improves the overall handoff flow around Goodecode, Deploy, Digital Brain, and Settings
- cleans up older handoff plumbing while the native app flow continues to mature

## 0.0.19

- replaces the top-right Goodecode editor action with a focused Build For Goodebot flow
- stops auto-opening the syntax guide and keeps it available only when the user explicitly opens the preview
- improves the generated handoff artifacts used by the native Goodebot workflow

## 0.0.18

- adds a Convert For Goodebot command in the editor title so Goodecode Python files can generate the native Goodebot runtime file from the top right
- updates the Studio copy and manifest to point at the native Goodebot runtime handoff instead of the older PROS export wording

## 0.0.17

- rebuilds the inner Goodecode mark with cleaner geometry so the GC symbol reads sharper inside the ringed logo
- keeps the restored ringed logo layout and icon-shell fit from the previous pass

## 0.0.16

- restores the newer ringed Goodecode logo that was designed after the blocky pass
- keeps the newer edge-to-edge icon-shell behavior so the restored logo fills the frame correctly

## 0.0.15

- removes the extra icon-shell padding so the Goodecode logo fills the rounded icon frame instead of floating inside it
- restores the full-canvas GC artwork for the packaged extension icon

## 0.0.14

- adds breathing room around the new Goodebot-matched Goodecode mark so it fits the extension icon mask better
- keeps the same GC logo layout while scaling it in from the edges

## 0.0.13

- rebuilds the Goodecode icon around the real Goodebot logo placement instead of the older extension-only spacing
- keeps the Goodebot ring layout and left glyph while swapping the right side to a matching blocky C

## 0.0.12

- scales the restored blocky Goodecode icon artwork up so it fills the extension icon better
- increases the Studio and sidebar icon display sizes to match the tighter crop

## 0.0.11

- restores the older blocky Goodecode icon style that mimics the Goodebot branding
- switches the Studio and sidebar webviews back to the restored packaged icon asset

## 0.0.10

- pushes the Goodecode icon composition nearly edge to edge to remove the remaining dead space
- enlarges the rounded square, rings, and center mark together for a fuller extension icon

## 0.0.9

- reduces the negative space in the packaged Goodecode icon so the rings and mark fill more of the square
- scales the inline Studio symbol up again to better match the tighter icon crop

## 0.0.8

- updates the Activity Bar sidebar icon to better match the newer ringed Goodecode C mark
- tightens the small-icon silhouette so it reads more consistently with the main logo

## 0.0.7

- scales the Goodecode symbol up so the rings and C mark use more of the icon canvas
- updates the packaged PNG icon to match the new fuller ringed Goodecode mark

## 0.0.6

- adds the blue and yellow Goodebot-style rings behind the Goodecode mark in the Studio and sidebar webviews
- keeps the current Goodecode C mark while borrowing the ring language from the main app logo

## 0.0.5

- restores the earlier Goodecode Studio background treatment while keeping the newer layout polish
- softens the card and hero surfaces back toward the original dark gold atmosphere

## 0.0.4

- replaces the Studio webview logo with an inline vector mark so the Goodecode logo always renders
- keeps the sidebar launcher and Studio header on the same built-in symbol treatment

## 0.0.3

- tightens the Goodecode Studio layout with compact feature tiles and a cleaner hero section
- embeds the Goodecode icons directly into the webviews so the broken image placeholder is gone
- refreshes the sidebar card to match the Studio styling and reduce visual clutter

## 0.0.2

- adds the bundled Goodecode syntax guide preview
- tightens the Goodebot install flow with open or remove and redownload actions
- keeps the install page UI product focused instead of exposing YAML editing

## 0.0.1

- initial Goodecode language extension scaffold
- file associations for `.goode.py` and `.goodecode`
- starter snippets
- basic syntax highlighting
- Marketplace-ready manifest metadata and Goodebot branding icon
- Goodecode sidebar tab with workspace tools and Goodebot install/open actions
- one-click macOS install flow from local Goodebot zip or app builds
- Goodecode Studio editor tab for Python-first workflow actions
- brain screen template generation and named one-script Python file creation
- YAML-driven Goodebot install page preview with workspace overrides
