# Recto Studio MCP Preview

This desktop edition includes the local publishing server and its Node.js
runtime. Install it alongside Recto Studio and connect a compatible MCP
client to inspect a layout, render PNG proofs, propose edits, and prepare
publication exports.

## Downloads

- **Windows x64** · `-setup_mcp.exe` installer.
- **macOS** · `-arm64_mcp.dmg` for Apple silicon or `-x86_64_mcp.dmg` for Intel.
  Requires macOS 14 or later. These preview apps are ad-hoc signed and are
  distributed without Apple notarization.
- **Linux x64** · `_mcp.deb` or `_mcp.AppImage`. The Debian package includes
  the installed server. For the AppImage, extract the separate
  `-mcp-runtime.zip` to give your client a persistent executable path.
- **Source** · GitHub provides source archives for this tag. Download
  `SHA256SUMS-mcp.txt` to verify the release assets.

## Connect a client

Open **File → Review Publishing Changes**. Copy the local MCP client
configuration and replace `CHOOSE_YOUR_WORKSPACE` with an absolute path to a
folder containing the projects you want to share. Add `--allow-write` as the
last argument when you want to enable new drafts, exports, and proposals.
Restart or reload your MCP client, then ask it to call
`recto_available_features`.

For the Linux runtime ZIP, set the client command to the absolute path to
`mcp-runtime/node`, then pass the absolute path to
`mcp-runtime/bin/recto.js` as the first argument. Follow it with
`mcp --workspace` and your workspace path.

The preview uses a separate desktop identity and manual updates. You choose
when to share the desktop canvas and when to apply a proposal. See the
[publishing automation guide](https://github.com/artificia1/recto-studio/blob/main/PUBLISHING_AUTOMATION.md)
for supported tools and example requests.
