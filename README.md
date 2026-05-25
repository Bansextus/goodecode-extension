# Goodecode

Goodecode is the VS Code sidekick for building Python robots for Goodebot. It helps you create Goodecode files, open Goodebot, install Goodebot on macOS, and move from writing code to running your robot with less setup.

## What You Get

- Goodecode file support for `.goode.py` and `.goodecode`
- syntax highlighting
- starter files and ready-to-use templates
- a dedicated `Goodecode Studio` tab inside VS Code
- one-click Goodebot install or open on macOS
- instant creation of single-script Python robot files
- quick access to brain screen files and detected Goodecode files
- a built-in guide for getting started
- Goodecode-native robot model docs for drivetrain, devices, controller mappings, auton selector, brain screen touch, SD runtime files, and deploy checks

## What Goodebot Handles

Goodebot stays the main home for the full robot workflow.

Use Goodebot for:

- workspace creation and management
- robot configuration
- exporting and deployment
- brain branding and runtime behavior
- Digital Brain tools and simulation

## Install

1. Open the Extensions view in VS Code.
2. Search for `bansextus.goodecode`.
3. Install the extension.
4. Open your Goodebot or Goodecode project folder.
5. Launch `Goodecode Studio`.

## File Types

- `.goode.py`
- `.goodecode`

## Goodecode Studio

`Goodecode Studio` is the main workspace inside the extension.

From there, you can:

- install Goodebot
- open Goodebot
- redownload Goodebot if needed
- create starter Goodecode files
- create a brain screen file
- create a single-script robot file
- open the built-in syntax guide
- jump into detected Goodecode files
- reveal your workspace in Finder

## Goodecode Chassis API

The bundled Goodecode guide documents the Goodecode-native chassis surface used by Goodebot Studio.

That surface includes:

- full Robot Builder model concepts
- motors, motor groups, sensors, ADI devices, and pneumatics
- master/partner controller mappings, button holds, toggles, curves, and deadbands
- chassis setup
- tank / arcade / d-pad drive helpers
- PID drive / turn / swing helpers
- odom pose helpers
- auton selector entries, slots, SD-backed selection, and field path data
- 480 x 240 brain screen pages, widgets, buttons, and touch hitboxes
- SD-required deploy contracts and runtime validation
- chassis tuning and exit-condition helpers
- robot weight and autonomous tuning helpers
- drift correction, side bias, slew, and driver curve helpers

The default starter should stay slim:

- drive is built in
- six-wheel toggles are not assumed
- GPS is not assumed
- mechanism controls should only appear when the project actually uses them

## macOS Goodebot Install

On macOS, the extension can find or install Goodebot for you.

It can use:

- a downloaded `Goodebot-macOS.zip`
- a local `Goodebot.app`
- an existing local Goodebot build already on your Mac

After install, it clears the usual macOS restrictions and opens Goodebot automatically.

## Best For

- students starting Python robot projects
- teams using Goodebot as the main workflow
- fast editing in VS Code with a smooth handoff into Goodebot

## Resources

- Repository: [Bansextus/Goodebot](https://github.com/Bansextus/Goodebot)
- Goodebot downloads: [Bansextus/Goodebot-Downloads](https://github.com/Bansextus/Goodebot-Downloads/releases)
