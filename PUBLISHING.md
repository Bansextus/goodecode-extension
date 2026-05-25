# Publishing Goodecode

Use this folder as the Marketplace companion for Goodecode by BanSextus inside Goodebot.

## Before You Publish

- Install Node.js so `npx` is available.
- Keep the extension ID as `bansextus.goodecode`.
- Keep the icon as a PNG. `vsce` will reject user-provided SVG icons.
- Keep any README or changelog image links on `https` URLs.

## Publisher Setup

1. Create or use an Azure DevOps organization.
2. Create a Personal Access Token with the Marketplace `Manage` scope.
3. Create a publisher in the Visual Studio Marketplace using the same Microsoft account.
4. Run `npx @vscode/vsce login bansextus`.

## Ship A VSIX

1. From this folder, run `npm run package`.
2. Share or install the generated `.vsix`.

## Publish To Marketplace

1. Update `package.json` version if needed.
2. Run `npm run publish:patch` for a patch release, or `npm run publish:minor` for a minor release.
3. Confirm the listing at `bansextus.goodecode`.

## Native Goodebot Expectations

- Goodebot owns the project scaffold and export pipeline.
- The extension owns editor language support only.
- Uploaded Goodecode projects should still receive the Goodebot brain icon through Goodebot's upload flow.
