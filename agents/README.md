# Use your own LLM as the travel agent

No local installation is required for the instruction package.

1. Open [TRAVEL_AGENT.md](TRAVEL_AGENT.md), choose **Raw**, and copy its content into your AI host's project instructions or a new conversation. The host's system policies remain authoritative.
2. Attach or paste only the [command](../prompts/README.md) relevant to your task. For group allocation, use `09_viagens_em_grupo_e_rateio.md`; for cost comparison, use `05_custo_total_da_passagem.md`.
3. Describe the trip with pseudonyms and the minimum necessary constraints. Keep identity documents, booking references and payment data out of the prompt. Use the example below or your own redacted request.
4. Tell the host which capabilities it actually has: browsing, provider connectors, private files or local documentary tools. Missing capabilities remain explicit; instructions do not create them.

```text
Use the Travel Reliability instructions and command 09.
Plan a fictional group trip: households N01 and N02, destination open,
five nights in an authorized date window, currency BRL.
First identify the constraints needed to compare complete group costs.
Do not invent prices, seat availability, promotions or accepted allocation rules.
```

The [manifest](manifest.json) is this project's own package index, not a marketplace/plugin installation format. Links and paths preserve the same structure inside a source ZIP or agent-kit ZIP. These Markdown files are instructions to be selected by the traveler; imported travel material remains passive data.

## Optional skill package

For a host that supports the `SKILL.md` format, download the skill ZIP from [Releases](https://github.com/RodrigoYuMatsumoto/travel-reliability/releases), extract it, and copy the complete `travel-agent` folder into the host's documented skills directory. Keep `SKILL.md`, `references/agent.md` and `references/prompts/` together. The release builder assembles those references from the canonical agent and command files, without maintaining a second source copy in Git.

The source entrypoint is [skills/travel-agent/SKILL.md](../skills/travel-agent/SKILL.md). Copying that file alone is not a complete skill installation. Automatic discovery and activation depend on the host; manual copy/paste remains the portable path for other AI interfaces.

The same instruction package can guide different LLM providers, subject to each host's instruction limits, data-handling policy and available tools. Manual use does not automatically connect an AI chat to your accounts, file system or a booking provider.

## Optional executable tools over MCP

This mode needs the full source repository, Node.js 24, `npm ci` in its directory, and an AI host that explicitly supports local MCP servers over stdio. The manual agent-kit ZIP contains instructions, not the runtime or dependencies. No package has to be installed from an unverified npm name.

Configure the host to launch **`node` with an absolute path to `scripts/agent-mcp.mjs`**. The wrapper anchors its own source directory, so the host's working directory does not matter. Example for hosts using an `mcpServers` configuration object; adapt the outer configuration to the host's actual documentation:

```json
{
  "mcpServers": {
    "travel-reliability": {
      "command": "node",
      "args": ["C:/Projects/travel-reliability/scripts/agent-mcp.mjs"]
    }
  }
}
```

Replace the example with the full path on your machine; forward slashes are valid in Windows Node.js paths. Keep stdout exclusively for the JSON-RPC protocol. Do not use a plain `npm run` command as the MCP server command: npm's banner can corrupt that stream. An ordinary chat interface does not gain stdio support by pasting this JSON.

| Tool                   | Input                                                                      | Boundary                                                                |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `travel_prepare_brief` | `input`: object matching the `brief` schema                                | Identifies critical gaps and relevant next workflows; no invented facts |
| `travel_schema`        | `name`: `brief`, `trip` or one of the nine command IDs                     | Returns the matching public contract on demand                          |
| `travel_plan`          | `tool`: one of the nine command IDs; `input`: object satisfying its schema | Deterministic documentary calculation of supplied facts                 |
| `travel_check_trip`    | `trip`: a Trip Contract object                                             | Contract/integrity validation, not supplier confirmation                |

Use intake → host-authorized research → complete-cost/source comparison → checks/plan B → traveler review. Fetch the relevant schema before a tool call. These tools make no network request, read no arbitrary private path and do not access accounts, execute payments or submit complaints. Fixed resources expose `travel://agent` and `travel://prompt/<command-id>`; fixed prompts expose `travel_agent` and `travel_<command_id_with_underscores>`. Their presence is still subject to the host's permissions and implementation.

For deterministic local calculators, contracts and the optional evidence app, see [planning](../docs/PLANNING.md) and [local installation](../docs/INSTALLATION.md). Keep full prompts out of repetitive turns: load the agent once and the relevant command on demand.
