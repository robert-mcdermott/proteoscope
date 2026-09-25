# Using Proteoscope with AI agents (MCP)

`proteoscope mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server. An AI agent such as Claude Code can use it to open structures and
prediction folders, rank predictions, list interactions and interface contacts,
superpose structures, load validation reports and render images.

The agent works in the Proteoscope page you see. You watch what it does, and
you can take over at any time.

- [Requirements](#requirements)
- [Claude Code](#claude-code)
- [Claude Desktop](#claude-desktop)
- [Collomia](#collomia)
- [Other clients](#other-clients)
- [Testing the server](#testing-the-server)
- [Using it](#using-it)
- [Tools](#tools)
- [Images](#images)
- [Options](#options)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)

## Requirements

- **A version with the `mcp` command.** `proteoscope --help` lists
  `proteoscope mcp` when yours has it. Otherwise install the latest release
  ([Installing Proteoscope](INSTALLING.md)) or build from source.
- **A browser.** Chrome, Edge or Brave works best, because they have WebGPU.
  Proteoscope opens in your default browser. Other browsers work too, more
  slowly (see [the Canvas preview](../README.md#the-badge-says-canvas-preview)).
- **The full path to the program.** Agents start Proteoscope themselves, often
  without your shell's `PATH`, so give them the full path. The installers put
  it here:

  | System | Path |
  | --- | --- |
  | macOS and Linux | `~/.local/bin/proteoscope`, for example `/Users/you/.local/bin/proteoscope` |
  | Windows | `%LOCALAPPDATA%\Programs\Proteoscope\proteoscope.exe` |

  Print it with `command -v proteoscope` (macOS and Linux) or
  `(Get-Command proteoscope).Source` (PowerShell).

The examples below use `/Users/you/.local/bin/proteoscope`; use your own path.

## Claude Code

Add the server for all your projects:

```sh
claude mcp add proteoscope --scope user -- /Users/you/.local/bin/proteoscope mcp
```

Everything after `--` is the command Claude Code runs, so Proteoscope's flags go
there too, for example `-- /Users/you/.local/bin/proteoscope mcp --offline`.

Claude Code has three scopes:

| Scope | Where it applies |
| --- | --- |
| `local` (the default) | You, in the current project only |
| `user` | You, in every project |
| `project` | Everyone working in the repository, through a `.mcp.json` file you commit; Claude Code asks each person to approve it |

For the project scope, `.mcp.json` looks like this:

```json
{
  "mcpServers": {
    "proteoscope": {
      "command": "/Users/you/.local/bin/proteoscope",
      "args": ["mcp"]
    }
  }
}
```

A committed file holds one path for everyone. It works only when everyone has
Proteoscope at that path or on their `PATH`, in which case the command can be
just `proteoscope`.

To check the server, run `claude mcp list` in a terminal, which shows whether it
connects. Inside a session, `/mcp` shows its status and tools. To remove it:

```sh
claude mcp remove proteoscope --scope user
```

Opening a large prediction campaign can take several minutes. If a call times
out, start Claude Code with a longer tool timeout, in milliseconds:

```sh
MCP_TOOL_TIMEOUT=900000 claude
```

## Claude Desktop

Open **Settings → Developer → Edit Config**. That opens
`claude_desktop_config.json`, which is in
`~/Library/Application Support/Claude/` on macOS and in `%APPDATA%\Claude\` on
Windows. Add Proteoscope under `mcpServers`:

```json
{
  "mcpServers": {
    "proteoscope": {
      "command": "/Users/you/.local/bin/proteoscope",
      "args": ["mcp"]
    }
  }
}
```

On Windows, double the backslashes in the path:
`"C:\\Users\\you\\AppData\\Local\\Programs\\Proteoscope\\proteoscope.exe"`.
Quit and reopen Claude Desktop; Proteoscope's tools then appear in the chat's
tools menu.

## Collomia

Add the server for all workspaces, with a timeout long enough for large
campaigns (Collomia's default is 30 seconds):

```sh
collo mcp add proteoscope --global --timeout 600 -- /Users/you/.local/bin/proteoscope mcp
```

Check it:

```sh
collo mcp test proteoscope
```

The test connects, pings the server and checks its tools. It does not open a
browser, because Proteoscope opens the page only when a tool needs it. Images
from `render_image` reach the model on provider routes that accept images.

## Other clients

Most clients take the same two things: the command (the full path to
Proteoscope) and its arguments (`["mcp"]`). Where the configuration lives
depends on the client, so see its documentation.

Clients that use an `mcpServers` object, such as Cursor
(`~/.cursor/mcp.json`) and Gemini CLI (`~/.gemini/settings.json`), take the
same entry as Claude Desktop above.

VS Code (`.vscode/mcp.json` in a workspace) uses `servers`:

```json
{
  "servers": {
    "proteoscope": {
      "type": "stdio",
      "command": "/Users/you/.local/bin/proteoscope",
      "args": ["mcp"]
    }
  }
}
```

OpenAI Codex CLI (`~/.codex/config.toml`) uses TOML:

```toml
[mcp_servers.proteoscope]
command = "/Users/you/.local/bin/proteoscope"
args = ["mcp"]
```

## Testing the server

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the
MCP project's tool for trying a server by hand. It needs Node.js and runs from
npm; it is not part of Proteoscope:

```sh
npx @modelcontextprotocol/inspector /Users/you/.local/bin/proteoscope mcp
```

It opens a page where you connect, list the tools and call them one at a time.
Try these:

1. `open_structure` with `{"id": "1M17"}`. Proteoscope opens in your browser
   and loads the EGFR kinase with erlotinib.
2. `get_interactions` with `{"selection": "resn AQ4"}`. You should get seven
   interactions, including the hydrogen bond to Met769 at 2.70 Å.
3. `render_image` with `{}`. You get a PNG of the view.

## Using it

Ask in your own words. Name Proteoscope, and give files and folders as
absolute paths. For example:

- "Open 1M17 in Proteoscope and tell me how erlotinib binds."
- "Fetch 1M17, add the AlphaFold model of P00533, superpose them and show me
  an image."
- "Load the validation report for 1M17 and list the worst residues near the
  ligand."
- "Open the prediction folders in /data/campaign/, rank them by ipSAE for
  chains A and B, and show me the best one."
- "Which interface residues of the best model have pLDDT below 70?"

**What you see.** The agent's tools act on the Proteoscope page in your
browser. It opens when the agent first needs it, and again if you close it.
Structures load, selections highlight, the camera moves and the triage table
updates. Each call's result appears as a message at the top of the page.
A triage gallery briefly shows each model in turn, then the scene goes back
to how it was.

**Taking over.** You can use the page while the agent works. Its commands act
on whatever structure is active, so if you change the active structure, the
agent's next command acts on your choice.

**One page.** Commands go to the Proteoscope tab opened most recently. If you
open a second tab, that tab takes over.

**Several agents.** Each agent session starts its own Proteoscope, with its
own page. If the port is busy, a nearby free port is used. When the session
ends, its Proteoscope stops.

**Beyond the tools.** `proteoscope_command` runs any command from
[Selections and Commands](../README.md#selections-and-commands), such as
`color plddt`, `show sticks within 5 of resn AQ4`, `map load` or
`conservation`. The agent can run `help` for the full list, or
`help <command>` for one command.

## Tools

| Tool | Arguments | What it does |
| --- | --- | --- |
| `open_structure` | **`id`**, `add` | Fetch a PDB entry (`1M17`) or the AlphaFold DB model of a UniProt accession (`P04637`). Replaces the scene unless `add` is true |
| `open_files` | **`paths`**, `add` | Open files and folders by absolute path: structures, or prediction folders from AlphaFold 3, AlphaFold Server, Boltz, Chai-1, ColabFold, Protenix and OpenFold3. Several jobs are scored and ranked together |
| `describe_structure` | none | Source, title, method, and resolution or confidence; chains with molecules and UniProt accessions; ligands; prediction scores, comparison and validation summary |
| `list_structures` | none | The structures in the scene, the active one, and superposition results |
| `select_residues` | **`selection`** | Select with the selection language (`chain A and resi 40-80`, `within 5 of resn STI`, `plddt < 70`) and return the residues |
| `get_interactions` | **`selection`** | Focus residues or a ligand and list its interactions (type, partner, atoms, distance), using PLIP's criteria |
| `interface_contacts` | **`chain_a`**, **`chain_b`** | The contacts between two chains, and the interface residues |
| `superpose` | **`moving`**, `reference`, `method`, `fit` | Superpose a structure, or `all`, by sequence (the default) or by structure alone (`structure`: TM-align, or MM-align for complexes). Returns RMSD, TM-score, lDDT and the number of aligned pairs |
| `validation_report` | none | The wwPDB validation summary of the active entry, with percentiles, ligand fit and the worst residues |
| `rank_predictions` | `metric`, `limit`, `level`, `chains` | Rank the open prediction jobs by `ipsae`, `pdockq2`, `pdockq`, `lis`, `iptm`, `ranking`, `ptm`, `plddt` or `crosslinks`. Returns each job's best model, or every model with `level: "models"`. `chains` scores one chain pair |
| `render_image` | `scale`, `transparent` | The current view as a PNG, at 1 to 4 times the view's size |
| `proteoscope_command` | **`command`** | Any other command |

Required arguments are in bold. Every tool returns a short text answer, and
structured data for agents that read it.

ipSAE, pDockQ, pDockQ2 and LIS are computed the same way from every
predictor's output, so they compare jobs from different tools. ipTM, pTM and
the ranking score are each tool's own.

## Images

`render_image` returns the view as an image the model can look at. Scale 1 is
enough for the agent to see what is shown. Images larger than 8 MB are
refused; render them at scale 1. To send images to the model, the client and
its model provider must accept images in tool results. Claude does.

The thumbnails from `triage gallery` and the image from `png`, both run
through `proteoscope_command`, come back as data in the result rather than as
images. To show the agent a model, open it with `triage show <n>`, then call
`render_image`.

## Options

`proteoscope mcp` takes the usual [command-line options](../README.md#command-line-options):

| Option | Use |
| --- | --- |
| `--port` | The preferred port (default 8765); a nearby free port is used if it is busy |
| `--offline` | No downloads: only local files and cached entries |
| `--cache-dir`, `--cache-max-age`, `--no-cache` | Where downloads are cached, and for how long |
| `--no-open` | Do not open a browser. Open the address yourself: Proteoscope writes it to the client's server log, and a tool that finds no page names it |

`--host` must be a local address, such as the default `127.0.0.1`: the MCP
server serves only this computer. To use Proteoscope from another machine,
forward the port with SSH (`ssh -N -L 8765:127.0.0.1:8765 you@server`).

## Privacy and security

- **Everything runs locally.** Proteoscope runs on your computer and answers
  only this computer. The agent talks to it through standard input and
  output. In MCP mode, the HTTP routes that scripts use
  (`/api/remote/command` and `/api/remote/open`) are turned off.
- **Files.** The agent can open any structure or prediction file your
  account can read, as you can.
- **What the model provider sees.** The results the agent receives, including
  images, go to the agent's model provider as part of the conversation.
- **Downloads.** Proteoscope downloads entries, validation reports, maps and
  annotations from the public databases, as it does when you use it.
  `--offline` turns that off.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The client cannot start the server | Use the full path to Proteoscope, and check that `proteoscope --help` lists `proteoscope mcp` |
| "No Proteoscope page is connected" | The browser did not open, or you used `--no-open`. Open the address in the message, in Chrome, Edge or Brave, then try again |
| A call times out | Opening many prediction jobs takes minutes. Raise the client's tool timeout (`MCP_TOOL_TIMEOUT` in Claude Code, `--timeout` in Collomia). Proteoscope allows 30 minutes for opening files and 2 minutes for other commands |
| "use an absolute path" | Give full paths; `~` is expanded |
| "The Proteoscope page was closed or reloaded before it answered" | Call the tool again. The page reopens when a tool needs it |
| The agent acts on the wrong structure | Tools act on the active structure. Ask the agent to call `list_structures` and name the structure it wants |
| Images are described but not seen | The client or model provider does not accept images in tool results |

Proteoscope writes its startup lines and errors to standard error, which most
clients keep in their MCP server log. Standard output carries only protocol
messages.

## How it works

The server speaks JSON-RPC 2.0 over standard input and output, one message per
line, in MCP versions 2024-11-05 to 2025-11-25. It handles `initialize`,
`ping`, `tools/list` and `tools/call`. Calls can be cancelled with
`notifications/cancelled`. Calls that take a while send progress notifications
when the client asks for them.

Each tool call becomes one Proteoscope command, or a request to open files,
and goes to the page through the same channel as
[remote control](../README.md#scripting). The page runs one request at a time
and posts back `{ ok, message, data }`. Proteoscope returns that as the tool's
result: text, structured content, or an image.

When the client closes standard input, calls still running get a second to
finish, and then Proteoscope stops.
