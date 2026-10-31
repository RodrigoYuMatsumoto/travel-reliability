# Choose how to use Travel Reliability

## 1. Your own AI: no local installation

Open [the portable agent](../agents/TRAVEL_AGENT.md), copy its content into your AI host's project instructions or a new conversation, and load only the [command](../prompts/README.md) needed for the task. See [agent setup](../agents/README.md). No Node.js, npm, Git, Docker, API key or local web server is required for these Markdown instructions.

The host must supply its own model and authorized capabilities. Instructions alone do not provide browsing, live inventory, private storage or executable tools. For a compatible skills host, the release skill ZIP supplies a complete `travel-agent` directory with `SKILL.md` and references; copy that directory into the host's documented skills location. A host without automatic skill discovery uses the manual instructions. Never put real identity documents, booking references or payment details in public repositories or example prompts.

## 2. Optional local app: ZIP and double-click on Windows

1. Install **Node.js 24 with npm** from the [official Node.js release directory](https://nodejs.org/download/release/latest-v24.x/). The launcher checks the major version; it does not install a runtime or change security policy.
2. Open the [GitHub repository](https://github.com/RodrigoYuMatsumoto/travel-reliability), choose **Code → Download ZIP**, and extract the ZIP completely to a folder you control. Git is not required. The manual agent-kit ZIP contains instructions only; download the full source for the app.
3. Double-click **`start-demo.cmd` in the extracted folder**. It finds its own directory, installs locked dependencies on first use or after a relevant lockfile change, checks the local ports and opens the browser only after the synthetic demo is ready.
4. Choose **Explorar demonstração / Explore demo**. Keep the terminal open while using the app. `Ctrl+C` stops its services.

First use needs internet to download dependencies from the locked npm graph. Subsequent starts reuse an installation matching the lockfile and platform. No Python, Docker, database or model key is needed for the text-document demo. Storage is temporary; restarting loses the demo workspace.

The local interface is **http://127.0.0.1:5173**. The API is **http://127.0.0.1:4310**, with health at `/health`. These addresses exist only on the computer running the launcher. They are not public GitHub websites. Do not run two demo instances on the same ports.

### Windows diagnostics

From PowerShell, call the launcher by its full path; the caller's directory does not matter:

```powershell
& "FULL-PATH-TO-EXTRACTED-REPOSITORY\start-demo.cmd" --check
```

`--check` reports prerequisite/dependency state without installing or starting services. `--install-only` prepares dependencies without starting services. `--no-browser` leaves browser opening to you. `--no-pause` is for automated terminal checks.

| Message                                           | Meaning and action                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_24_REQUIRED` / missing Node                 | Install the official Node.js 24 distribution, then reopen the terminal/launcher. No administrative runtime installation is performed by the project.                                        |
| `NPM_NOT_FOUND_WITH_NODE_INSTALLATION`            | The Node distribution does not include npm at the expected location. Install the official Node.js 24 package with npm or use the developer commands after installing dependencies yourself. |
| `DEPENDENCY_INSTALL_FAILED`                       | Read npm's error; check network/proxy and file access. The launcher keeps certificate verification and lockfile checks enabled.                                                             |
| `PORT_UNAVAILABLE_4310` / `PORT_UNAVAILABLE_5173` | Another process is using a required address or access is denied. Close the known app you started or use its existing window. The launcher neither kills nor trusts an unknown process.      |
| `DEMO_START_TIMEOUT`                              | A service did not become ready. Read the preceding server error. No browser is opened against an unverified service.                                                                        |
| `Missing script` from a manual npm command        | npm selected another project's package.json. Run from the extracted repository or use its launcher.                                                                                         |
| `ERR_CONNECTION_REFUSED`                          | No server accepted the connection. Start the launcher, wait for `READY`, then reload the local address.                                                                                     |

## 3. Developers on supported platforms

From the full source directory with Node.js 24 and npm:

```sh
npm ci
node scripts/bootstrap-demo.mjs
```

The bootstrap anchors paths to the source directory and checks readiness. For the existing development command, use `npm run demo` and open port 5173 yourself. For a single compiled server, use `npm run build` followed by `npm start`, then open port 4310. Stop the current demo first so the port is available.

Production requires a separately configured identity provider, HTTPS, durable private stores, keys and isolated ingestion. Follow the [full-source operations guide](https://github.com/RodrigoYuMatsumoto/travel-reliability/blob/main/docs/OPERATIONS.md). The local demo is not a durable evidence archive or an unattended production service.
